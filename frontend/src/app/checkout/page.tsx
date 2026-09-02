'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/cart-context';
import { api } from '@/lib/api';
import { payForOrder } from '@/lib/razorpay';
import { OrderStatusTracker } from '@/components/OrderStatusTracker';
import { siteConfig } from '@/lib/siteConfig';

type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'WALLET';

interface SavedAddress {
  id: string;
  label: 'HOME' | 'WORK' | 'OTHER';
  nickname: string | null;
  addressLine: string;
  phone: string;
  instructions: string | null;
  isDefault: boolean;
  pincode: string | null;
}

const ADDRESS_LABEL_ICON: Record<SavedAddress['label'], string> = { HOME: '🏠', WORK: '💼', OTHER: '📍' };

export default function CheckoutPage() {
  const router = useRouter();
  const { items, updateQuantity, removeItem, clear, totalRs } = useCart();
  const [fulfillment, setFulfillment] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const [deliveryPincode, setDeliveryPincode] = useState('');
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [deliveryFeeQuote, setDeliveryFeeQuote] = useState<{ feeRs: number; zoneName: string; distanceKm: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [placing, setPlacing] = useState(false);
  const [paymentStage, setPaymentStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placedOrder, setPlacedOrder] = useState<{ id: string; orderNumber: string; status: string; totalRs: string; discountRs: string; deliveryFeeRs: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  // Best-effort estimate shown before the order is placed — the real,
  // authoritative fee is always recomputed server-side at order
  // creation (never trusted from this client-side quote), so this is
  // purely a "here's roughly what you'll pay" preview.
  const estimatedGrandTotalRs = totalRs + (fulfillment === 'DELIVERY' ? (deliveryFeeQuote?.feeRs ?? 0) : 0);
  const [walletBalanceRs, setWalletBalanceRs] = useState(0);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  const totalProteinG = items.reduce((s, i) => s + i.proteinG * i.quantity, 0);

  // Require login BEFORE the customer fills out the whole form and
  // clicks "Place Order" — checking here, not just relying on the
  // backend's 401, is what avoids the confusing "session expired"
  // message someone who was never logged in used to see only after
  // getting all the way to the end. The cart itself intentionally stays
  // usable without an account (browsing/building a cart shouldn't
  // require signing up) — this is specifically the point where login
  // actually becomes necessary.
  useEffect(() => {
    const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('pp_token');
    if (!hasToken) {
      router.replace('/login?redirect=/checkout');
    } else {
      setAuthChecked(true);
    }
  }, [router]);

  // Prefill from a saved default address if one exists — falls back to
  // the last-used address (the old behavior) only if the customer
  // hasn't saved any addresses yet. Sequenced with Promise.all rather
  // than two independent effects, since firing both in parallel could
  // otherwise let getDashboard's fallback overwrite the default address
  // depending on which one happened to resolve first.
  useEffect(() => {
    Promise.all([api.myAddresses().catch(() => []), api.getDashboard().catch(() => null)]).then(([addrs, dashboard]: [SavedAddress[], any]) => {
      setSavedAddresses(addrs);
      const def = addrs.find((a) => a.isDefault);
      if (def) {
        setDeliveryAddress(def.addressLine);
        setDeliveryPhone(def.phone);
        if (def.instructions) setDeliveryInstructions(def.instructions);
        if (def.pincode) setDeliveryPincode(def.pincode);
        setSelectedAddressId(def.id);
      } else if (dashboard?.address) {
        setDeliveryAddress(dashboard.address);
      }
      setWalletBalanceRs(dashboard?.walletBalanceRs ?? 0);
    });
  }, []);

  const pickAddress = (a: SavedAddress) => {
    setSelectedAddressId(a.id);
    setDeliveryAddress(a.addressLine);
    setDeliveryPhone(a.phone);
    setDeliveryInstructions(a.instructions ?? '');
    setDeliveryPincode(a.pincode ?? '');
  };

  // Entirely optional — declining or an unsupported browser just means
  // no live ETA later on the tracking page, not a broken checkout.
  // Never blocks placing the order either way.
  const shareLiveLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationError('Location sharing isn\u2019t supported on this browser.');
      return;
    }
    setLocationError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setDeliveryCoords(coords);
        setLocating(false);
        // Best-effort — a failed or empty quote just means delivery
        // stays free, exactly as it always was before this feature
        // existed, never a reason to block checkout.
        api.getDeliveryFeeQuote(coords.lat, coords.lng).then(setDeliveryFeeQuote).catch(() => undefined);
      },
      () => {
        setLocationError('Location access was declined — delivery still works, just without a live ETA.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const placeOrder = async () => {
    if (fulfillment === 'DELIVERY' && (!deliveryAddress.trim() || !deliveryPhone.trim())) {
      setError('A delivery address and contact phone are required for delivery orders');
      return;
    }

    setPlacing(true);
    setError(null);
    setPaymentStage(null);
    try {
      const order = await api.createOrder({
        channel: 'WEBSITE',
        fulfillmentType: fulfillment,
        paymentMethod,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          addonIds: i.addons.map((a) => a.id),
          specialInstructions: i.specialInstructions,
        })),
        couponCode: couponCode.trim() || undefined,
        ...(fulfillment === 'DELIVERY'
          ? {
              deliveryAddress,
              deliveryContactPhone: deliveryPhone,
              deliveryInstructions: deliveryInstructions || undefined,
              deliveryPincode: deliveryPincode || undefined,
              deliveryLat: deliveryCoords?.lat,
              deliveryLng: deliveryCoords?.lng,
            }
          : {}),
      });

      if (paymentMethod === 'CASH' || paymentMethod === 'WALLET') {
        // Both are already fully settled by the time createOrder above
        // returns — CASH is collected in person, WALLET was debited
        // server-side as part of creating the order itself. Neither
        // needs a Razorpay popup; if the wallet debit had failed
        // (insufficient balance — defense in depth, since the button
        // is already disabled for this case, but balance could change
        // between page load and submit), createOrder above would have
        // thrown and this code would never be reached at all.
        clear();
        setPlacedOrder({ id: order.id, orderNumber: order.orderNumber, status: order.status, totalRs: order.totalRs, discountRs: order.discountRs, deliveryFeeRs: order.deliveryFeeRs });
        return;
      }

      // Online payment — same shared helper the "Pay Now" retry button
      // on My Orders uses, so both paths stay identical rather than
      // risking drift between two separate implementations.
      await payForOrder({
        api,
        orderId: order.id,
        businessName: siteConfig.businessName,
        primaryColorHex: siteConfig.primaryColorHex,
        onStage: setPaymentStage,
        onSuccess: () => {
          clear();
          setPlacedOrder({ id: order.id, orderNumber: order.orderNumber, status: order.status, totalRs: order.totalRs, discountRs: order.discountRs, deliveryFeeRs: order.deliveryFeeRs });
          setPlacing(false);
        },
        onError: (message) => {
          setError(message);
          setPlacing(false);
        },
        onDismiss: () => {
          setPlacing(false);
          setError('Payment was cancelled. Your order is saved as pending — you can retry from My Orders.');
        },
      });
      return; // placing stays true until the handler/dismiss above resolves it
    } catch (err: any) {
      setError(err.message ?? 'Could not place order');
      setPlacing(false);
    }
  };

  if (!authChecked) {
    return (
      <section className="mx-auto max-w-md px-4 py-24 text-center text-sm text-brand-body">
        Checking your login…
      </section>
    );
  }

  if (placedOrder) {
    return (
      <section className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-2 text-4xl">🐼</p>
        <h1 className="mb-1 text-xl font-extrabold uppercase tracking-tight text-brand-black">Order placed!</h1>
        <p className="mb-4 text-sm text-brand-body">Tracking updates live as your order moves through the kitchen.</p>
        <div className="mb-4 rounded-2xl bg-brand-black p-4 text-brand-white">
          {Number(placedOrder.discountRs) > 0 && (
            <p className="text-xs text-brand-accent">Coupon applied: -₹{Number(placedOrder.discountRs).toFixed(0)}</p>
          )}
          {Number(placedOrder.deliveryFeeRs) > 0 && (
            <p className="text-xs text-brand-grey">+ ₹{Number(placedOrder.deliveryFeeRs).toFixed(0)} delivery fee</p>
          )}
          <p className="text-xs uppercase tracking-wide text-brand-grey">Total Charged</p>
          <p className="text-xl font-extrabold">₹{(Number(placedOrder.totalRs) + Number(placedOrder.deliveryFeeRs)).toFixed(0)}</p>
        </div>
        <OrderStatusTracker orderId={placedOrder.id} orderNumber={placedOrder.orderNumber} initialStatus={placedOrder.status} />
        <a
          href="/nutrition"
          className="mt-6 inline-block rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          View My Nutrition
        </a>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="mb-4 text-sm text-brand-body">Your cart is empty.</p>
        <a href="/menu" className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent">
          Browse Menu
        </a>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Your Cart</h1>

      <div className="mb-6 flex flex-col gap-3">
        {items.map((item) => (
          <div key={item.key} className="rounded-2xl border border-brand-grey bg-brand-white p-4">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <p className="font-bold text-brand-black">{item.name}</p>
                {item.addons.length > 0 && (
                  <p className="text-xs text-brand-body">{item.addons.map((a) => a.name).join(', ')}</p>
                )}
                <p className="text-xs text-brand-body">{item.proteinG.toFixed(0)}g protein each</p>
                {item.specialInstructions && (
                  <p className="text-xs font-semibold text-brand-primary">Note: {item.specialInstructions}</p>
                )}
              </div>
              <button onClick={() => removeItem(item.key)} className="text-xs text-brand-body underline">
                Remove
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 rounded-full border border-brand-grey px-3 py-1">
                <button onClick={() => updateQuantity(item.key, item.quantity - 1)} className="px-2 font-bold text-brand-black">−</button>
                <span className="w-6 text-center font-bold text-brand-black">{item.quantity}</span>
                <button onClick={() => updateQuantity(item.key, item.quantity + 1)} className="px-2 font-bold text-brand-black">+</button>
              </div>
              <span className="font-bold text-brand-black">
                ₹{((item.basePriceRs + item.addons.reduce((s, a) => s + a.extraPriceRs, 0)) * item.quantity).toFixed(0)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Fulfillment</p>
        <div className="flex gap-2">
          {(['PICKUP', 'DELIVERY'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFulfillment(f)}
              className={`flex-1 rounded-full border-2 py-2 text-sm font-bold uppercase tracking-wide ${
                fulfillment === f ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
              }`}
            >
              {f === 'PICKUP' ? 'Shop Pickup' : 'Delivery'}
            </button>
          ))}
        </div>

        {fulfillment === 'DELIVERY' && (
          <div className="mt-4 flex flex-col gap-3">
            {savedAddresses.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-body">Saved addresses</p>
                <div className="flex flex-wrap gap-2">
                  {savedAddresses.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => pickAddress(a)}
                      className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold ${
                        selectedAddressId === a.id ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
                      }`}
                    >
                      {ADDRESS_LABEL_ICON[a.label]} {a.label === 'OTHER' && a.nickname ? a.nickname : a.label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setSelectedAddressId(null);
                      setDeliveryAddress('');
                      setDeliveryPhone('');
                      setDeliveryInstructions('');
                    }}
                    className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold ${
                      selectedAddressId === null ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
                    }`}
                  >
                    + New address
                  </button>
                </div>
              </div>
            )}

            <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
              Delivery address
              <textarea
                value={deliveryAddress}
                onChange={(e) => { setDeliveryAddress(e.target.value); setSelectedAddressId(null); }}
                placeholder="House/flat no., street, landmark, floor…"
                rows={2}
                className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black outline-none focus:border-brand-primary"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
              Contact phone
              <input
                type="tel"
                value={deliveryPhone}
                onChange={(e) => setDeliveryPhone(e.target.value)}
                placeholder="+91 9xxxxxxxxx"
                className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black outline-none focus:border-brand-primary"
              />
            </label>

            <div>
              {deliveryCoords ? (
                <p className="text-xs font-semibold text-brand-primary">📍 Live location shared — you&apos;ll see a real ETA once your order is on the way</p>
              ) : (
                <button
                  type="button"
                  onClick={shareLiveLocation}
                  disabled={locating}
                  className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
                >
                  {locating ? 'Getting your location…' : '📍 Share Live Location (for a real ETA)'}
                </button>
              )}
              {locationError && <p className="mt-1 text-xs text-brand-body">{locationError}</p>}
            </div>

            <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
              Pincode <span className="normal-case text-brand-body/70">(optional — helps us confirm we deliver to you)</span>
              <input
                value={deliveryPincode}
                onChange={(e) => setDeliveryPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="e.g. 560001"
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black outline-none focus:border-brand-primary"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
              Delivery instructions <span className="normal-case text-brand-body/70">(optional)</span>
              <input
                value={deliveryInstructions}
                onChange={(e) => setDeliveryInstructions(e.target.value)}
                placeholder="e.g. Ring twice, leave at gate"
                className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black outline-none focus:border-brand-primary"
              />
            </label>
          </div>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Payment</p>
        <div className="flex flex-wrap gap-2">
          {([
            { value: 'CASH', label: fulfillment === 'PICKUP' ? 'Pay at Counter' : 'Cash on Delivery' },
            { value: 'UPI', label: 'UPI' },
            { value: 'CARD', label: 'Card' },
            { value: 'WALLET', label: `Wallet (₹${walletBalanceRs.toFixed(0)})`, disabled: walletBalanceRs < estimatedGrandTotalRs },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              onClick={() => !('disabled' in opt && opt.disabled) && setPaymentMethod(opt.value)}
              disabled={'disabled' in opt && opt.disabled}
              className={`flex-1 rounded-full border-2 py-2 text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40 ${
                paymentMethod === opt.value ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
          Coupon code <span className="normal-case text-brand-body/70">(optional)</span>
          <input
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            placeholder="e.g. WELCOME10"
            className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black outline-none focus:border-brand-primary"
          />
        </label>
        {couponCode && <p className="mt-1 text-xs text-brand-body">Discount is applied when you place the order — your bill will reflect it.</p>}
      </div>

      <div className="mb-6 flex items-center justify-between rounded-2xl bg-brand-black p-4 text-brand-white">
        <div>
          <p className="text-xs uppercase tracking-wide text-brand-grey">Total protein this order</p>
          <p className="font-bold">{totalProteinG.toFixed(0)}g</p>
        </div>
        <div className="text-right">
          {fulfillment === 'DELIVERY' && deliveryFeeQuote && deliveryFeeQuote.feeRs > 0 && (
            <p className="text-xs text-brand-grey">+ ₹{deliveryFeeQuote.feeRs.toFixed(0)} delivery ({deliveryFeeQuote.zoneName})</p>
          )}
          <p className="text-xs uppercase tracking-wide text-brand-grey">Total (before coupon)</p>
          <p className="text-xl font-extrabold">₹{estimatedGrandTotalRs.toFixed(0)}</p>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <button
        onClick={placeOrder}
        disabled={placing}
        className="w-full rounded-full bg-brand-primary py-4 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
      >
        {paymentStage ?? (placing ? 'Placing Order…' : paymentMethod === 'CASH' || paymentMethod === 'WALLET' ? 'Place Order' : `Pay ₹${estimatedGrandTotalRs.toFixed(0)}`)}
      </button>
    </section>
  );
}
