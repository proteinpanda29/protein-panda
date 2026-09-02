'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { useOnlineStatus } from '@/lib/useOnlineStatus';
import { enqueueSale, getQueue, syncQueue, QueuedSale } from '@/lib/offlineQueue';
import { getSocket } from '@/lib/socket';

interface Customer {
  id: string;
  name: string;
  user: { phone: string | null; email: string | null };
}

interface Redemption {
  id: string;
  pointsSpent: number;
  reward: { name: string; valueRs: string | null };
}

interface Addon {
  id: string;
  group: 'BASE' | 'FLAVOUR' | 'LIQUID' | 'ADDON';
  name: string;
  isRequired: boolean;
  extraPriceRs: string;
}

interface Product {
  id: string;
  name: string;
  basePriceRs: string;
  isCustomisable: boolean;
  addonOptions: Addon[];
}

interface CartLine {
  key: string;
  productId: string;
  name: string;
  quantity: number;
  unitPriceRs: number;
  addonIds: string[];
  addonNames: string[];
}

const GROUP_LABELS: Record<string, string> = {
  BASE: 'Base',
  FLAVOUR: 'Flavour',
  LIQUID: 'Liquid',
  ADDON: 'Add-ons',
};

export default function PosPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showWalkInForm, setShowWalkInForm] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'CARD'>('CASH');
  const [couponCode, setCouponCode] = useState('');
  const [manualDiscount, setManualDiscount] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<'PICKUP' | 'DINE_IN'>('PICKUP');
  const [availableRedemptions, setAvailableRedemptions] = useState<Redemption[]>([]);
  const [selectedRedemptionId, setSelectedRedemptionId] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [pendingUpiPayment, setPendingUpiPayment] = useState<{ orderId: string; orderNumber: string; shortUrl: string } | null>(null);

  const isOnline = useOnlineStatus();
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const refreshQueue = () => setQueue(getQueue());
  useEffect(refreshQueue, []);

  const runSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncQueue((payload) => api.posCreateSale(payload));
      refreshQueue();
      if (result.synced > 0 || result.failed > 0) {
        setSyncMessage(
          `Synced ${result.synced} sale${result.synced === 1 ? '' : 's'}` +
            (result.failed > 0 ? ` · ${result.failed} failed (see below)` : ''),
        );
      }
    } finally {
      setSyncing(false);
    }
  };

  // Auto-sync the moment connectivity returns — the whole point of
  // queueing is that the counter doesn't need to remember to do this.
  useEffect(() => {
    if (isOnline && getQueue().some((s) => s.status === 'pending')) {
      runSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  useEffect(() => {
    api.listProducts().then(setProducts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.posSearchCustomers(query).then(setResults).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Whenever a customer is selected (or cleared), refresh which
  // discount vouchers they have available — and reset any previously
  // selected one, since it may not belong to the new customer.
  useEffect(() => {
    setSelectedRedemptionId('');
    if (!customer) {
      setAvailableRedemptions([]);
      return;
    }
    api.posAvailableRedemptions(customer.id).then(setAvailableRedemptions).catch(() => setAvailableRedemptions([]));
  }, [customer]);

  const addSimple = (p: Product) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.key === p.id);
      if (existing) return prev.map((l) => (l.key === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key: p.id, productId: p.id, name: p.name, quantity: 1, unitPriceRs: Number(p.basePriceRs), addonIds: [], addonNames: [] }];
    });
  };

  const addCustomized = (line: CartLine) => {
    setCart((prev) => [...prev, line]);
    setCustomizing(null);
  };

  const updateQty = (key: string, qty: number) => {
    setCart((prev) => (qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity: qty } : l))));
  };

  const total = cart.reduce((sum, l) => sum + l.unitPriceRs * l.quantity, 0);

  const completeSale = async () => {
    if (!customer || cart.length === 0) return;
    setBusy(true);
    setError(null);

    const salePayload = {
      customerId: customer.id,
      paymentMethod,
      items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, addonIds: l.addonIds })),
      couponCode: couponCode.trim() || undefined,
      manualDiscountRs: manualDiscount.trim() ? Number(manualDiscount) : undefined,
      fulfillmentType,
      redemptionId: selectedRedemptionId || undefined,
    };

    if (!isOnline) {
      // No connection — save it locally instead of blocking the sale.
      // It'll sync automatically the moment connectivity returns (or via
      // the manual Sync Now button below).
      enqueueSale(salePayload, customer.name, total);
      refreshQueue();
      setCart([]);
      setCustomer(null);
      setQuery('');
      setCouponCode('');
      setBusy(false);
      setSyncMessage('Offline — sale saved, will sync automatically once back online.');
      return;
    }

    try {
      const order = await api.posCreateSale(salePayload);
      if (order.paymentLink) {
        // UPI — the sale isn't actually paid yet. Show the QR code and
        // wait for the real webhook-confirmed payment (via the same
        // live order:update socket event already used everywhere else
        // in the app), rather than treating the sale as done.
        setPendingUpiPayment({ orderId: order.id, orderNumber: order.orderNumber, shortUrl: order.paymentLink.shortUrl });
      } else {
        setCompletedOrder({ id: order.id, orderNumber: order.orderNumber });
      }
      setCart([]);
      setCustomer(null);
      setCouponCode('');
      setManualDiscount('');
      setQuery('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Listen for the real payment confirmation — fires the moment
  // Razorpay's webhook confirms the customer actually paid, via the
  // same live socket connection already used for order status
  // elsewhere in this app.
  useEffect(() => {
    if (!pendingUpiPayment) return;
    const socket = getSocket();
    if (!socket) return;

    const handler = (payload: { orderId: string; orderNumber: string }) => {
      if (payload.orderId !== pendingUpiPayment.orderId) return;
      setCompletedOrder({ id: payload.orderId, orderNumber: payload.orderNumber });
      setPendingUpiPayment(null);
    };
    socket.on('order:update', handler);
    return () => {
      socket.off('order:update', handler);
    };
  }, [pendingUpiPayment]);

  if (pendingUpiPayment) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="mb-2 text-xl font-extrabold uppercase tracking-tight text-brand-black">
          Scan to Pay — Order #{pendingUpiPayment.orderNumber}
        </h1>
        <p className="mb-6 text-sm text-brand-body">
          Ask the customer to scan this with their phone&apos;s UPI app. This screen updates automatically the moment
          payment is confirmed.
        </p>
        <div className="mb-6 flex justify-center rounded-2xl border-2 border-brand-grey bg-brand-white p-6">
          <QRCodeSVG value={pendingUpiPayment.shortUrl} size={220} />
        </div>
        <p className="mb-4 text-xs text-brand-body">
          Trouble scanning?{' '}
          <a href={pendingUpiPayment.shortUrl} target="_blank" rel="noreferrer" className="underline">
            Open the payment link directly
          </a>
        </p>
        <button
          onClick={() => setPendingUpiPayment(null)}
          className="rounded-full border-2 border-brand-black px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (completedOrder) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="mb-2 text-4xl">🐼</p>
        <h1 className="mb-2 text-xl font-extrabold uppercase tracking-tight text-brand-black">Sale Complete!</h1>
        <p className="mb-6 text-sm text-brand-body">Order #{completedOrder.orderNumber} — e-bill sent, stock deducted, points awarded.</p>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => api.adminDownloadInvoicePdf(completedOrder.id, completedOrder.orderNumber)}
            className="rounded-full border-2 border-brand-black px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
          >
            📄 Print / Download Receipt
          </button>
          <button
            onClick={() => setCompletedOrder(null)}
            className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
          >
            New Sale
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">New Sale</h1>

      {!isOnline && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          🔴 Offline — sales will be saved locally and synced automatically once you&apos;re back online. Keep selling normally.
        </div>
      )}

      {(queue.length > 0 || syncMessage) && (
        <div className="mb-4 rounded-xl bg-yellow-50 p-3 text-sm">
          {syncMessage && <p className="mb-1 text-yellow-800">{syncMessage}</p>}
          {queue.filter((s) => s.status !== 'synced').length > 0 && (
            <>
              <p className="mb-2 font-semibold text-yellow-800">
                {queue.filter((s) => s.status === 'pending' || s.status === 'syncing').length} sale(s) waiting to sync
                {queue.filter((s) => s.status === 'failed').length > 0 &&
                  ` · ${queue.filter((s) => s.status === 'failed').length} failed`}
              </p>
              <ul className="mb-2 flex flex-col gap-1">
                {queue
                  .filter((s) => s.status !== 'synced')
                  .map((s) => (
                    <li key={s.id} className="text-xs text-brand-body">
                      {s.customerLabel} · ₹{s.totalRs.toFixed(0)} · {s.status}
                      {s.errorMessage && ` — ${s.errorMessage}`}
                    </li>
                  ))}
              </ul>
              {isOnline && (
                <button
                  onClick={runSync}
                  disabled={syncing}
                  className="rounded-full bg-yellow-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-yellow-700 disabled:opacity-60"
                >
                  {syncing ? 'Syncing…' : 'Sync Now'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {!customer ? (
        <div className="max-w-md">
          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-brand-body">Find Customer</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, phone, or email…"
            className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
          />
          {results.length > 0 && (
            <div className="mb-3 flex flex-col gap-2">
              {results.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCustomer(c)}
                  className="rounded-xl border border-brand-grey bg-brand-white p-3 text-left hover:border-brand-primary"
                >
                  <p className="font-semibold text-brand-black">{c.name}</p>
                  <p className="text-xs text-brand-body">{c.user.phone ?? c.user.email}</p>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setShowWalkInForm((v) => !v)} className="text-xs font-semibold text-brand-primary underline">
            {showWalkInForm ? 'Cancel' : '+ New walk-in customer'}
          </button>
          {showWalkInForm && <WalkInForm onCreated={(c) => setCustomer(c)} />}
        </div>
      ) : (
        <>
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-brand-primary bg-brand-bg p-4">
            <div>
              <p className="font-bold text-brand-black">{customer.name}</p>
              <p className="text-xs text-brand-body">{customer.user.phone ?? customer.user.email}</p>
            </div>
            <button onClick={() => setCustomer(null)} className="text-xs font-semibold text-brand-body underline">
              Change
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Menu</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => (p.isCustomisable ? setCustomizing(p) : addSimple(p))}
                    className="rounded-xl border border-brand-grey bg-brand-white p-3 text-left hover:border-brand-primary"
                  >
                    <p className="text-sm font-semibold text-brand-black">{p.name}</p>
                    <p className="text-xs text-brand-body">₹{p.basePriceRs}{p.isCustomisable ? ' · Customise' : ''}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Cart</h2>
              <div className="mb-4 flex flex-col gap-2">
                {cart.length === 0 && <p className="text-sm text-brand-body">No items yet.</p>}
                {cart.map((l) => (
                  <div key={l.key} className="rounded-xl border border-brand-grey bg-brand-white p-3 text-sm">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold text-brand-black">{l.name}</span>
                      <span className="text-brand-black">₹{(l.unitPriceRs * l.quantity).toFixed(0)}</span>
                    </div>
                    {l.addonNames.length > 0 && <p className="mb-1 text-xs text-brand-body">{l.addonNames.join(', ')}</p>}
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(l.key, l.quantity - 1)} className="rounded-full border border-brand-grey px-2">−</button>
                      <span>{l.quantity}</span>
                      <button onClick={() => updateQty(l.key, l.quantity + 1)} className="rounded-full border border-brand-grey px-2">+</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mb-4 flex gap-2">
                {(['CASH', 'UPI', 'CARD'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPaymentMethod(m)}
                    className={`flex-1 rounded-full border-2 py-2 text-xs font-bold uppercase ${
                      paymentMethod === m ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="mb-3 flex gap-2">
                {(['PICKUP', 'DINE_IN'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFulfillmentType(f)}
                    className={`flex-1 rounded-full border-2 py-2 text-xs font-bold uppercase ${
                      fulfillmentType === f ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
                    }`}
                  >
                    {f === 'PICKUP' ? 'Takeaway' : 'Dine-In'}
                  </button>
                ))}
              </div>

              <input
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="Coupon code (optional)"
                className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm uppercase"
              />

              <input
                value={manualDiscount}
                onChange={(e) => setManualDiscount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="Manual discount ₹ (optional)"
                inputMode="decimal"
                className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
              />

              {availableRedemptions.length > 0 && (
                <select
                  value={selectedRedemptionId}
                  onChange={(e) => setSelectedRedemptionId(e.target.value)}
                  className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
                >
                  <option value="">No reward voucher applied</option>
                  {availableRedemptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.reward.name} — ₹{r.reward.valueRs} off ({r.pointsSpent} pts spent)
                    </option>
                  ))}
                </select>
              )}

              <div className="mb-3 flex items-center justify-between rounded-xl bg-brand-black p-3 text-brand-white">
                <span className="text-xs uppercase tracking-wide text-brand-grey">Total (before discounts)</span>
                <span className="text-lg font-extrabold">₹{total.toFixed(0)}</span>
              </div>

              {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

              <button
                onClick={completeSale}
                disabled={busy || cart.length === 0}
                className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-50"
              >
                {busy ? 'Processing…' : 'Complete Sale'}
              </button>
            </div>
          </div>
        </>
      )}

      {customizing && (
        <PosCustomizeModal product={customizing} onClose={() => setCustomizing(null)} onAdd={addCustomized} />
      )}
    </div>
  );
}

function WalkInForm({ onCreated }: { onCreated: (c: Customer) => void }) {
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const customer = await api.posCreateWalkIn(name, identifier);
      onCreated({
        id: customer.id,
        name: customer.name,
        user: { phone: identifier.includes('@') ? null : identifier, email: identifier.includes('@') ? identifier : null },
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-brand-grey bg-brand-white p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
      />
      <input
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        placeholder="Phone or email"
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
      />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={saving}
        className="w-full rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
      >
        {saving ? 'Creating…' : 'Create & Select'}
      </button>
    </div>
  );
}

function PosCustomizeModal({
  product,
  onClose,
  onAdd,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const grouped: Record<string, Addon[]> = { BASE: [], FLAVOUR: [], LIQUID: [], ADDON: [] };
  product.addonOptions.forEach((a) => grouped[a.group]?.push(a));

  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    (['BASE', 'FLAVOUR', 'LIQUID'] as const).forEach((g) => {
      if (grouped[g][0]) initial[g] = grouped[g][0].id;
    });
    return initial;
  });
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set());

  const chosen = [
    ...Object.values(selected).map((id) => product.addonOptions.find((a) => a.id === id)).filter((a): a is Addon => !!a),
    ...product.addonOptions.filter((a) => addonIds.has(a.id)),
  ];
  const unitPrice = Number(product.basePriceRs) + chosen.reduce((s, a) => s + Number(a.extraPriceRs), 0);
  const missing = (['BASE', 'FLAVOUR', 'LIQUID'] as const).filter((g) => grouped[g].length > 0 && !selected[g]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-brand-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-brand-black">{product.name}</h3>
          <button onClick={onClose}>✕</button>
        </div>

        {(['BASE', 'FLAVOUR', 'LIQUID'] as const).map(
          (g) =>
            grouped[g].length > 0 && (
              <div key={g} className="mb-3">
                <p className="mb-2 text-xs font-bold uppercase text-brand-body">{GROUP_LABELS[g]}</p>
                <div className="flex flex-wrap gap-2">
                  {grouped[g].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelected((s) => ({ ...s, [g]: opt.id }))}
                      className={`rounded-full border-2 px-3 py-1 text-xs font-semibold ${
                        selected[g] === opt.id ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
                      }`}
                    >
                      {opt.name}
                    </button>
                  ))}
                </div>
              </div>
            ),
        )}

        {grouped.ADDON.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-bold uppercase text-brand-body">Add-ons</p>
            <div className="flex flex-wrap gap-2">
              {grouped.ADDON.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() =>
                    setAddonIds((prev) => {
                      const next = new Set(prev);
                      next.has(opt.id) ? next.delete(opt.id) : next.add(opt.id);
                      return next;
                    })
                  }
                  className={`rounded-full border-2 px-3 py-1 text-xs font-semibold ${
                    addonIds.has(opt.id) ? 'border-brand-accent bg-brand-accent text-brand-black' : 'border-brand-grey text-brand-black'
                  }`}
                >
                  {opt.name} +₹{opt.extraPriceRs}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() =>
            onAdd({
              key: `${product.id}-${Date.now()}`,
              productId: product.id,
              name: product.name,
              quantity: 1,
              unitPriceRs: unitPrice,
              addonIds: chosen.map((a) => a.id),
              addonNames: chosen.map((a) => a.name),
            })
          }
          disabled={missing.length > 0}
          className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50"
        >
          Add to Cart · ₹{unitPrice.toFixed(0)}
        </button>
      </div>
    </div>
  );
}
