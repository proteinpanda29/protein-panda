'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { siteConfig } from '@/lib/siteConfig';
import { payForOrder } from '@/lib/razorpay';
import { useCart } from '@/lib/cart-context';
import { useRouter } from 'next/navigation';

interface OrderItem {
  id: string;
  quantity: number;
  proteinG: string;
  calories: number;
  product: { id: string; name: string; basePriceRs: string; isActive: boolean };
  addons: { addon: { id: string; name: string; group: string; extraPriceRs: string } }[];
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalRs: string;
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  createdAt: string;
  items: OrderItem[];
  payment: { method: string; status: string } | null;
}

const RATING_TAGS = ['Fast', 'Polite', 'Professional', 'Good handling'];

export default function OrdersPage() {
  const router = useRouter();
  const { addItem } = useCart();
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reviewingProduct, setReviewingProduct] = useState<string | null>(null);
  const [ratingOrder, setRatingOrder] = useState<string | null>(null);
  const [billOrder, setBillOrder] = useState<string | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reorder = (order: Order) => {
    const unavailable = order.items.filter((i) => !i.product.isActive);
    const available = order.items.filter((i) => i.product.isActive);

    if (available.length === 0) {
      setMessage('None of the items from this order are available anymore.');
      return;
    }

    available.forEach((item) => {
      addItem(
        {
          productId: item.product.id,
          name: item.product.name,
          basePriceRs: Number(item.product.basePriceRs),
          addons: item.addons.map((a) => ({ id: a.addon.id, name: a.addon.name, group: a.addon.group, extraPriceRs: Number(a.addon.extraPriceRs) })),
          proteinG: Number(item.proteinG) / item.quantity,
          calories: Math.round(item.calories / item.quantity),
        },
        item.quantity,
      );
    });

    if (unavailable.length > 0) {
      setMessage(`Added ${available.length} item(s) to cart — ${unavailable.length} item(s) from this order are no longer available and were skipped.`);
    }
    router.push('/checkout');
  };

  const load = () => {
    api
      .myOrders()
      .then(setOrders)
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  // Handles both paths from a push notification action button
  // ("Don't ring the bell" / "Leave at door"): a message relayed from
  // the service worker when a tab was already open, or a URL query
  // param when the service worker had to open a fresh tab instead.
  // Best-effort throughout — a failure here (e.g. token expired) never
  // blocks the rest of the page from working normally.
  useEffect(() => {
    const submitPreference = (orderId: string, preference: string) => {
      if (preference !== 'DONT_RING_BELL' && preference !== 'LEAVE_AT_DOOR') return;
      api
        .setDeliveryPreference(orderId, preference)
        .then(() => setMessage(preference === 'DONT_RING_BELL' ? "Got it — we won't ring the bell." : "Got it — we'll leave it at the door."))
        .catch(() => undefined);
    };

    const params = new URLSearchParams(window.location.search);
    const highlightOrderId = params.get('highlight');
    const urlPreference = params.get('setDeliveryPref');
    if (highlightOrderId && urlPreference) {
      submitPreference(highlightOrderId, urlPreference);
      // Clean the query params off the URL so a page refresh doesn't
      // resubmit the same preference again.
      window.history.replaceState({}, '', '/orders');
    }

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'DELIVERY_PREFERENCE') {
        submitPreference(event.data.orderId, event.data.preference);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);

  if (error) {
    return (
      <section className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-4 text-sm text-brand-body">
          Couldn&apos;t load your orders — make sure you&apos;re logged in. ({error})
        </p>
        <a href="/login" className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent">
          Go to Login
        </a>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">My Orders</h1>

      {message && <p className="mb-4 rounded-xl bg-brand-bg p-3 text-sm text-brand-black">{message}</p>}

      {orders.length === 0 && <p className="text-sm text-brand-body">No orders yet.</p>}

      <div className="flex flex-col gap-4">
        {orders.map((order) => (
          <div key={order.id} className="rounded-2xl border border-brand-grey bg-brand-white p-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-bold text-brand-black">#{order.orderNumber}</p>
              <span className="rounded-full bg-brand-grey/50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-black">
                {order.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="mb-1 text-xs text-brand-body">{new Date(order.createdAt).toLocaleString()}</p>
            <p className="mb-3 text-sm font-bold text-brand-black">₹{order.totalRs}</p>

            {(order.status === 'DELIVERED' || order.status === 'CANCELLED') && (
              <button
                onClick={() => reorder(order)}
                className="mb-3 rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
              >
                ↻ Reorder
              </button>
            )}

            {order.payment && order.payment.status === 'PENDING' && order.payment.method !== 'CASH' && (
              <PayNowCard order={order} onPaid={() => { setMessage(`Payment confirmed for #${order.orderNumber}.`); load(); }} />
            )}

            {(order.status === 'RECEIVED' || order.status === 'ACCEPTED') && (
              <div className="mb-3">
                {cancellingOrder === order.id ? (
                  <CancelOrderForm
                    orderId={order.id}
                    onDone={(msg) => {
                      setMessage(msg);
                      setCancellingOrder(null);
                      load();
                    }}
                    onCancel={() => setCancellingOrder(null)}
                  />
                ) : (
                  <button
                    onClick={() => setCancellingOrder(order.id)}
                    className="text-xs font-semibold text-red-600 underline"
                  >
                    Cancel this order
                  </button>
                )}
              </div>
            )}

            <button
              onClick={() => setBillOrder(billOrder === order.id ? null : order.id)}
              className="mb-3 text-xs font-semibold text-brand-primary underline"
            >
              {billOrder === order.id ? 'Hide bill' : 'View bill'}
            </button>

            {billOrder === order.id && <BillView orderId={order.id} orderNumber={order.orderNumber} />}

            <div className="mb-3 flex flex-col gap-2">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm">
                  <span className="text-brand-body">
                    {item.quantity}× {item.product.name}
                  </span>
                  <button
                    onClick={() => setReviewingProduct(reviewingProduct === item.product.id ? null : item.product.id)}
                    className="text-xs font-semibold text-brand-primary underline"
                  >
                    Review
                  </button>
                </div>
              ))}
            </div>

            {reviewingProduct && order.items.some((i) => i.product.id === reviewingProduct) && (
              <ReviewForm
                productId={reviewingProduct}
                onDone={(msg) => {
                  setMessage(msg);
                  setReviewingProduct(null);
                }}
              />
            )}

            {order.fulfillmentType === 'DELIVERY' && order.status === 'DELIVERED' && (
              <div className="mt-2 border-t border-brand-grey pt-3">
                {ratingOrder === order.id ? (
                  <DeliveryRatingForm
                    orderId={order.id}
                    onDone={(msg) => {
                      setMessage(msg);
                      setRatingOrder(null);
                    }}
                  />
                ) : (
                  <button
                    onClick={() => setRatingOrder(order.id)}
                    className="text-xs font-semibold text-brand-primary underline"
                  >
                    Rate your delivery
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewForm({ productId, onDone }: { productId: string; onDone: (msg: string) => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addPhoto = async (file: File) => {
    if (photoUrls.length >= 5) {
      setError('You can attach up to 5 photos.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const sig = await api.getReviewUploadSignature();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('api_key', sig.apiKey);
      formData.append('timestamp', String(sig.timestamp));
      formData.append('signature', sig.signature);
      formData.append('folder', sig.folder);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: 'POST', body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? 'Photo upload failed');
      }
      const { secure_url } = await res.json();
      setPhotoUrls((prev) => [...prev, secure_url]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.addProductReview(productId, rating, comment || undefined, photoUrls.length > 0 ? photoUrls : undefined);
      onDone('Thanks for the review! 🐼');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-3 rounded-xl bg-brand-bg p-3">
      <div className="mb-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} className="text-lg">
            {n <= rating ? '⭐' : '☆'}
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="How was it? (optional)"
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
        rows={2}
      />

      {photoUrls.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {photoUrls.map((url, i) => (
            <div key={url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-brand-grey">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Review photo ${i + 1}`} className="h-full w-full object-cover" />
              <button
                onClick={() => setPhotoUrls((prev) => prev.filter((u) => u !== url))}
                className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] text-white"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {photoUrls.length < 5 && (
        <label className="mb-2 inline-block cursor-pointer rounded-full border-2 border-brand-black px-3 py-1.5 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary">
          {uploading ? 'Uploading…' : '📷 Add Photo'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) addPhoto(file);
              e.target.value = '';
            }}
          />
        </label>
      )}

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={saving}
        className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
      >
        {saving ? 'Submitting…' : 'Submit Review'}
      </button>
    </div>
  );
}

function DeliveryRatingForm({ orderId, onDone }: { orderId: string; onDone: (msg: string) => void }) {
  const [rating, setRating] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.rateDelivery(orderId, rating, tags);
      onDone('Thanks for rating your delivery! 🐼');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-brand-bg p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-body">How was your delivery?</p>
      <div className="mb-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} className="text-lg">
            {n <= rating ? '⭐' : '☆'}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {RATING_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            className={`rounded-full border-2 px-3 py-1 text-xs font-semibold ${
              tags.includes(tag) ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={saving}
        className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
      >
        {saving ? 'Submitting…' : 'Submit Rating'}
      </button>
    </div>
  );
}

function BillView({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const [invoice, setInvoice] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api
      .getInvoice(orderId)
      .then(setInvoice)
      .catch((err) => setError(err.message));
  }, [orderId]);

  const resend = async () => {
    setResending(true);
    try {
      await api.resendInvoice(orderId);
      setResent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  };

  const downloadPdf = async () => {
    setDownloading(true);
    setError(null);
    try {
      await api.downloadInvoicePdf(orderId, orderNumber);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  if (error) return <p className="mb-3 text-xs text-red-600">{error}</p>;
  if (!invoice) return <p className="mb-3 text-xs text-brand-body">Loading bill…</p>;

  const itemsText = invoice.items
    .map((i: any) => `${i.quantity}x ${i.product.name}${i.addons?.length ? ` (${i.addons.map((a: any) => a.addon.name).join(', ')})` : ''} - ₹${i.lineTotalRs}`)
    .join('\n');
  const whatsappText = encodeURIComponent(
    `${siteConfig.mascotEmoji} ${siteConfig.businessName} Bill #${orderNumber}\n\n${itemsText}\n\nTotal: ₹${invoice.totalRs}`,
  );

  return (
    <div className="mb-3 rounded-xl bg-brand-bg p-4">
      <div className="mb-2 flex flex-col gap-1 text-sm">
        {invoice.items.map((item: any) => (
          <div key={item.id} className="flex justify-between">
            <span className="text-brand-body">
              {item.quantity}× {item.product.name}
              {item.addons?.length > 0 && (
                <span className="text-xs text-brand-body/70"> ({item.addons.map((a: any) => a.addon.name).join(', ')})</span>
              )}
            </span>
            <span className="text-brand-black">₹{item.lineTotalRs}</span>
          </div>
        ))}
      </div>
      <div className="mb-3 border-t border-brand-grey pt-2 text-sm">
        <div className="flex justify-between"><span className="text-brand-body">Subtotal</span><span>₹{invoice.subtotalRs}</span></div>
        {Number(invoice.discountRs) > 0 && (
          <div className="flex justify-between text-brand-primary"><span>Discount</span><span>-₹{invoice.discountRs}</span></div>
        )}
        <div className="flex justify-between font-bold text-brand-black"><span>Total</span><span>₹{invoice.totalRs}</span></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={`https://wa.me/?text=${whatsappText}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-500"
        >
          💬 Share on WhatsApp
        </a>
        <button
          onClick={downloadPdf}
          disabled={downloading}
          className="rounded-full border-2 border-brand-black px-3 py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
        >
          {downloading ? 'Opening…' : '📄 Download PDF'}
        </button>
        <button
          onClick={resend}
          disabled={resending}
          className="rounded-full border-2 border-brand-black px-3 py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
        >
          {resending ? 'Sending…' : resent ? '✓ Sent' : '✉️ Email me this bill'}
        </button>
      </div>
    </div>
  );
}

function PayNowCard({ order, onPaid }: { order: Order; onPaid: () => void }) {
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const retry = () => {
    setError(null);
    payForOrder({
      api,
      orderId: order.id,
      businessName: siteConfig.businessName,
      primaryColorHex: siteConfig.primaryColorHex,
      onStage: setStage,
      onSuccess: onPaid,
      onError: setError,
      onDismiss: () => setError('Payment was cancelled — you can try again anytime.'),
    });
  };

  return (
    <div className="mb-3 rounded-xl border-2 border-yellow-400 bg-yellow-50 p-3">
      <p className="mb-2 text-xs font-bold text-yellow-900">
        ⚠ Payment wasn&apos;t completed for this order — it hasn&apos;t been sent to the kitchen yet.
      </p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={retry}
        disabled={!!stage}
        className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
      >
        {stage ?? `Pay ₹${order.totalRs} Now`}
      </button>
    </div>
  );
}

function CancelOrderForm({
  orderId,
  onDone,
  onCancel,
}: {
  orderId: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      setError('Please tell us why you\u2019re cancelling.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.cancelMyOrder(orderId, reason);
      onDone(
        result.refund
          ? 'Order cancelled. Your refund is being processed.'
          : 'Order cancelled.',
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl bg-red-50 p-3">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why are you cancelling? (required)"
        rows={2}
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
      />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded-full bg-red-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-red-700 disabled:opacity-60"
        >
          {submitting ? 'Cancelling…' : 'Confirm Cancellation'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black"
        >
          Never mind
        </button>
      </div>
    </div>
  );
}
