'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useOrderUpdates } from '@/lib/useOrderUpdates';
import { printReceipt } from '@/lib/printReceipt';

/**
 * A short, distinct two-tone chime for a genuinely new incoming order —
 * generated directly via the Web Audio API rather than an audio file,
 * so there's no asset to go missing and nothing to load. Wrapped in a
 * try/catch since some browsers block audio before any user
 * interaction on the page; a failed beep should never break the order
 * list itself.
 */
function playNewOrderAlert() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const playTone = (freq: number, startTime: number, duration: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };
    const now = ctx.currentTime;
    playTone(880, now, 0.15);
    playTone(1175, now + 0.15, 0.25);
  } catch {
    // Silently skip — a missed sound is not worth surfacing an error for.
  }
}

function printReceiptViaBluetooth(order: {
  orderNumber: string;
  createdAt: string;
  customer: { name: string };
  fulfillmentType: string;
  totalRs: string;
  items: { quantity: number; unitPriceRs: string; product: { name: string } }[];
}) {
  printReceipt({
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    customerName: order.customer.name,
    fulfillmentType: order.fulfillmentType,
    totalRs: order.totalRs,
    items: order.items.map((i) => ({ quantity: i.quantity, name: i.product.name, unitPriceRs: Number(i.unitPriceRs) })),
  });
}

const STATUS_FLOW = ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const STATUS_BUTTON_LABEL: Record<string, string> = {
  ACCEPTED: 'Accept Order',
  PREPARING: 'Start Preparing',
  READY: 'Food Ready',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Mark Delivered',
};

interface Rider {
  id: string;
  name: string;
  activeDeliveries: number;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  totalRs: string;
  refundedRs: string;
  fulfillmentType: string;
  createdAt: string;
  customer: { name: string };
  items: { quantity: number; unitPriceRs: string; product: { name: string } }[];
  payment: { method: string; status: string; amountRs: string } | null;
  deliveryOrder: { id: string; address: string | null; deliveryPersonId: string | null; deliveryPerson: { name: string } | null } | null;
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [assigningOrder, setAssigningOrder] = useState<string | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<string | null>(null);
  const [refundingOrder, setRefundingOrder] = useState<string | null>(null);

  const load = () => {
    api
      .adminOrders(statusFilter || undefined)
      .then(setOrders)
      .catch((err) => setError(err.message));
  };

  useOrderUpdates((event) => {
    const alreadyKnown = knownOrderIdsRef.current.has(event.orderId);

    if (alreadyKnown) {
      setOrders((prev) => prev.map((o) => (o.id === event.orderId ? { ...o, status: event.status } : o)));
      return;
    }

    knownOrderIdsRef.current.add(event.orderId);
    load();
    playNewOrderAlert();

    setNewOrderIds((prev) => {
      const next = new Set(prev);
      next.add(event.orderId);
      return next;
    });
    setTimeout(() => {
      setNewOrderIds((cur) => {
        const cleared = new Set(cur);
        cleared.delete(event.orderId);
        return cleared;
      });
    }, 15000);
  });

  useEffect(load, [statusFilter]);
  useEffect(() => {
    orders.forEach((o) => knownOrderIdsRef.current.add(o.id));
  }, [orders]);
  useEffect(() => {
    api.adminAvailableRiders().then(setRiders).catch(() => undefined);
  }, []);

  const advanceStatus = async (order: OrderRow) => {
    const idx = STATUS_FLOW.indexOf(order.status);
    const next = STATUS_FLOW[idx + 1];
    if (!next) return;
    setUpdating(order.id);
    try {
      await api.adminUpdateOrderStatus(order.id, next);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  const collectCash = async (order: OrderRow) => {
    setUpdating(order.id);
    try {
      await api.adminCollectCash(order.id);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  const cancelOrder = async (order: OrderRow, reason: string) => {
    setUpdating(order.id);
    try {
      await api.adminCancelOrder(order.id, reason);
      setCancellingOrder(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  const refundOrder = async (order: OrderRow, amountRs: number, reason: string, method?: 'CASH' | 'RAZORPAY' | 'WALLET') => {
    setUpdating(order.id);
    try {
      await api.adminRefundOrder(order.id, amountRs, reason, method);
      setRefundingOrder(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  const assignRider = async (order: OrderRow, riderId: string) => {
    if (!riderId) return;
    setUpdating(order.id);
    try {
      await api.adminAssignDelivery(order.id, riderId);
      setAssigningOrder(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  const assignBestRider = async (order: OrderRow) => {
    setUpdating(order.id);
    setError(null);
    try {
      await api.adminAssignBestRider(order.id);
      setAssigningOrder(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  if (error) {
    return <p className="text-sm text-brand-body">Couldn&apos;t load orders — make sure you&apos;re logged in as admin. ({error})</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Orders</h1>
        <div className="flex items-center gap-3">
          <a href="/admin/refunds" className="text-xs font-bold uppercase tracking-wide text-brand-body underline">
            Refund History
          </a>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-brand-grey bg-brand-white px-3 py-2 text-sm text-brand-black"
          >
            <option value="">All statuses</option>
            {STATUS_FLOW.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-brand-body">No orders match this filter.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) => {
            const idx = STATUS_FLOW.indexOf(order.status);
            const next = STATUS_FLOW[idx + 1];
            const needsRider = order.fulfillmentType === 'DELIVERY' && order.deliveryOrder && !order.deliveryOrder.deliveryPersonId;
            const canCancel = order.status !== 'CANCELLED' && order.status !== 'DELIVERED';
            const refundableRs = order.payment ? Number(order.payment.amountRs) - Number(order.refundedRs) : 0;
            const canRefund = order.payment?.status === 'PAID' && refundableRs > 0;

            return (
              <div
                key={order.id}
                className={`rounded-2xl border p-4 transition-all ${
                  newOrderIds.has(order.id)
                    ? 'animate-pulse border-brand-primary bg-brand-primary/10 shadow-lg shadow-brand-primary/30'
                    : 'border-brand-grey bg-brand-white'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-brand-black">
                      #{order.orderNumber} · {order.customer.name}
                      {newOrderIds.has(order.id) && (
                        <span className="ml-2 rounded-full bg-brand-primary px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-brand-white">
                          🆕 New
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-brand-body">
                      {order.items.map((i) => `${i.quantity}× ${i.product.name}`).join(', ')}
                    </p>
                    {order.fulfillmentType === 'DELIVERY' && order.deliveryOrder && (
                      <p className="text-xs text-brand-body">
                        📍 {order.deliveryOrder.address ?? 'No address on file'}
                        {order.deliveryOrder.deliveryPerson && ` · 🛵 ${order.deliveryOrder.deliveryPerson.name}`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-brand-grey/50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-black">
                      {order.status.replace(/_/g, ' ')}
                    </span>
                    {order.payment && (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                          order.payment.status === 'PAID' ? 'bg-brand-primary text-brand-white' : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {order.payment.status === 'PAID' ? '✅ Paid' : `${order.payment.method} · Pending`}
                      </span>
                    )}
                    <span className="font-bold text-brand-black">₹{order.totalRs}</span>

                    {order.payment?.method === 'CASH' && order.payment.status !== 'PAID' && (
                      <button
                        onClick={() => collectCash(order)}
                        disabled={updating === order.id}
                        className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
                      >
                        Collect Cash
                      </button>
                    )}

                    {needsRider &&
                      (assigningOrder === order.id ? (
                        <div className="flex items-center gap-2">
                          <select
                            autoFocus
                            onChange={(e) => assignRider(order, e.target.value)}
                            disabled={updating === order.id}
                            className="rounded-full border-2 border-brand-primary px-3 py-2 text-xs font-bold text-brand-black"
                          >
                            <option value="">Pick a rider…</option>
                            {riders.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} — {r.activeDeliveries === 0 ? 'free' : `${r.activeDeliveries} active`}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => assignBestRider(order)}
                            disabled={updating === order.id || riders.length === 0}
                            title="Picks the on-duty rider with the fewest active deliveries right now"
                            className="rounded-full bg-brand-primary px-3 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50"
                          >
                            ⚡ Best
                          </button>
                          <button
                            onClick={() => setAssigningOrder(null)}
                            className="text-xs font-semibold text-brand-body underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAssigningOrder(order.id)}
                          className="rounded-full border-2 border-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-primary hover:bg-brand-primary hover:text-brand-white"
                        >
                          🛵 Assign Rider
                        </button>
                      ))}

                    {next && !needsRider && (
                      <button
                        onClick={() => advanceStatus(order)}
                        disabled={updating === order.id}
                        className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
                      >
                        {updating === order.id ? 'Updating…' : STATUS_BUTTON_LABEL[next] ?? `Mark ${next.replace(/_/g, ' ')}`}
                      </button>
                    )}

                    {canRefund && (
                      <button
                        onClick={() => setRefundingOrder(refundingOrder === order.id ? null : order.id)}
                        className="rounded-full border-2 border-yellow-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-yellow-700 hover:bg-yellow-600 hover:text-white"
                      >
                        💰 Refund
                      </button>
                    )}

                    <button
                      onClick={() => api.adminDownloadInvoicePdf(order.id, order.orderNumber)}
                      className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
                    >
                      📄 Receipt
                    </button>

                    <button
                      onClick={() => printReceiptViaBluetooth(order)}
                      className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
                    >
                      🖨️ Print
                    </button>

                    {canCancel && (
                      <button
                        onClick={() => setCancellingOrder(cancellingOrder === order.id ? null : order.id)}
                        className="rounded-full border-2 border-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 hover:bg-red-600 hover:text-white"
                      >
                        ✕ Cancel
                      </button>
                    )}
                  </div>
                </div>

                {cancellingOrder === order.id && (
                  <CancelForm
                    busy={updating === order.id}
                    onSubmit={(reason) => cancelOrder(order, reason)}
                    onClose={() => setCancellingOrder(null)}
                  />
                )}

                {refundingOrder === order.id && (
                  <RefundForm
                    maxRs={refundableRs}
                    busy={updating === order.id}
                    onSubmit={(amountRs, reason, method) => refundOrder(order, amountRs, reason, method)}
                    onClose={() => setRefundingOrder(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CancelForm({ busy, onSubmit, onClose }: { busy: boolean; onSubmit: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="mt-3 rounded-xl bg-red-50 p-3">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for cancelling (required)"
        rows={2}
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
      />
      <div className="flex gap-2">
        <button
          onClick={() => reason.trim() && onSubmit(reason)}
          disabled={busy || !reason.trim()}
          className="rounded-full bg-red-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-red-700 disabled:opacity-60"
        >
          {busy ? 'Cancelling…' : 'Confirm Cancellation'}
        </button>
        <button onClick={onClose} className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black">
          Close
        </button>
      </div>
    </div>
  );
}

function RefundForm({
  maxRs,
  busy,
  onSubmit,
  onClose,
}: {
  maxRs: number;
  busy: boolean;
  onSubmit: (amountRs: number, reason: string, method: 'CASH' | 'RAZORPAY' | 'WALLET') => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(maxRs));
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'AUTO' | 'CASH' | 'RAZORPAY' | 'WALLET'>('AUTO');

  return (
    <div className="mt-3 rounded-xl bg-yellow-50 p-3">
      <p className="mb-2 text-xs text-brand-body">Remaining refundable: ₹{maxRs.toFixed(2)}</p>
      <div className="mb-2 flex gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          max={maxRs}
          className="w-32 rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for refund (required)"
          className="flex-1 rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
        />
      </div>
      <div className="mb-2 flex gap-2">
        {(['AUTO', 'WALLET', 'CASH'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold uppercase ${
              method === m ? 'border-yellow-600 bg-yellow-600 text-white' : 'border-brand-grey text-brand-black'
            }`}
          >
            {m === 'AUTO' ? 'Original method' : m === 'WALLET' ? '💳 To Wallet (instant)' : 'Cash'}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => reason.trim() && Number(amount) > 0 && onSubmit(Number(amount), reason, method === 'AUTO' ? (undefined as any) : method)}
          disabled={busy || !reason.trim() || Number(amount) <= 0 || Number(amount) > maxRs}
          className="rounded-full bg-yellow-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-yellow-700 disabled:opacity-60"
        >
          {busy ? 'Processing…' : 'Confirm Refund'}
        </button>
        <button onClick={onClose} className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black">
          Close
        </button>
      </div>
    </div>
  );
}
