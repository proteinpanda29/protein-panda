'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useOrderUpdates } from '@/lib/useOrderUpdates';
import { logout } from '@/lib/session';
import { ClockWidget } from '@/components/ClockWidget';

interface DeliveryOrderRow {
  id: string;
  address: string | null;
  contactPhone: string;
  deliveryInstructions: string | null;
  pickedUpAt: string | null;
  outForDeliveryAt: string | null;
  arrivedAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  order: {
    orderNumber: string;
    status: string;
    totalRs: string;
    fulfillmentType: string;
    payment: { status: string; method: string } | null;
    items: { quantity: number; product: { name: string } }[];
  };
}

const FAILURE_REASONS: { value: string; label: string }[] = [
  { value: 'CUSTOMER_UNAVAILABLE', label: 'Customer unavailable' },
  { value: 'WRONG_ADDRESS', label: 'Wrong address' },
  { value: 'CUSTOMER_CANCELLED', label: 'Customer cancelled' },
  { value: 'RIDER_ISSUE', label: 'Rider issue' },
  { value: 'VEHICLE_ISSUE', label: 'Vehicle issue' },
  { value: 'RESTAURANT_DELAY', label: 'Restaurant delay' },
  { value: 'OTHER', label: 'Other' },
];

export default function DeliveryDashboardPage() {
  const [orders, setOrders] = useState<DeliveryOrderRow[]>([]);
  const [showDelivered, setShowDelivered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [isOnDuty, setIsOnDuty] = useState(false);
  const [dutyLoading, setDutyLoading] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  const load = () => {
    api
      .deliveryMyOrders()
      .then(setOrders)
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  // Fetch the rider's real current duty status on mount — without this,
  // the toggle always started showing "Off Duty" on every page load or
  // refresh, even for a rider who was genuinely still on duty.
  useEffect(() => {
    api
      .deliveryMe()
      .then((profile) => setIsOnDuty(profile.isOnDuty))
      .catch(() => undefined);
  }, []);

  // If ops/admin reassigns or updates an order that's in this rider's list,
  // reflect it live instead of waiting for the next manual refresh.
  useOrderUpdates(() => load());

  const toggleDuty = async () => {
    setDutyLoading(true);
    try {
      const updated = await api.deliverySetDuty(!isOnDuty);
      setIsOnDuty(updated.isOnDuty);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDutyLoading(false);
    }
  };

  // While on duty, share live location for any order currently out for
  // delivery — the browser's geolocation API only, no third-party SDK.
  // The backend rejects pings for orders that aren't OUT_FOR_DELIVERY,
  // so this is safe to run continuously without extra client-side logic.
  useEffect(() => {
    if (!isOnDuty || typeof navigator === 'undefined' || !navigator.geolocation) return;

    const outForDeliveryOrder = orders.find((o) => o.outForDeliveryAt && !o.deliveredAt);
    if (!outForDeliveryOrder) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        api
          .deliveryUpdateLocation(outForDeliveryOrder.id, pos.coords.latitude, pos.coords.longitude)
          .catch(() => undefined); // don't spam errors for transient GPS hiccups
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
    watchIdRef.current = id;

    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [isOnDuty, orders]);

  const act = async (deliveryOrderId: string, action: string, otp?: string) => {
    setUpdating(deliveryOrderId);
    setError(null);
    try {
      await api.deliveryUpdateStatus(deliveryOrderId, action, otp);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  const reportFailure = async (deliveryOrderId: string, reason: string, note: string) => {
    setUpdating(deliveryOrderId);
    setError(null);
    try {
      await api.deliveryReportFailure(deliveryOrderId, reason, note || undefined);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  if (error) {
    return (
      <section className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-4 text-sm text-brand-body">
          Couldn&apos;t load your deliveries — make sure you&apos;re logged in with a delivery account. ({error})
        </p>
        <a
          href="/login"
          className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          Go to Login
        </a>
      </section>
    );
  }

  const visible = orders.filter((o) => (showDelivered ? true : !o.deliveredAt));

  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-4">
        <ClockWidget />
      </div>

      <div className="mb-4 flex items-center justify-between rounded-2xl border border-brand-grey bg-brand-white p-4">
        <div>
          <p className="text-sm font-bold text-brand-black">{isOnDuty ? '🟢 On Duty' : '🔴 Off Duty'}</p>
          <p className="text-xs text-brand-body">{isOnDuty ? 'Visible for new delivery assignments' : "You won't receive new assignments"}</p>
        </div>
        <button
          onClick={toggleDuty}
          disabled={dutyLoading}
          className={`rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wide disabled:opacity-60 ${
            isOnDuty ? 'bg-brand-grey/50 text-brand-black' : 'bg-brand-primary text-brand-white'
          }`}
        >
          {dutyLoading ? '...' : isOnDuty ? 'Go Off Duty' : 'Go On Duty'}
        </button>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-extrabold uppercase tracking-tight text-brand-black">My Deliveries</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-body">
            <input type="checkbox" checked={showDelivered} onChange={(e) => setShowDelivered(e.target.checked)} />
            Show delivered
          </label>
          <button onClick={logout} className="text-xs font-bold uppercase text-red-600 underline">
            Logout
          </button>
        </div>
      </div>

      {visible.length === 0 && (
        <p className="rounded-2xl border border-brand-grey bg-brand-white p-6 text-center text-sm text-brand-body">
          No deliveries assigned right now.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {visible.map((d) => (
          <DeliveryCard key={d.id} d={d} onAct={act} onReportFailure={reportFailure} busy={updating === d.id} />
        ))}
      </div>
    </section>
  );
}

function DeliveryCard({
  d,
  onAct,
  onReportFailure,
  busy,
}: {
  d: DeliveryOrderRow;
  onAct: (id: string, action: string, otp?: string) => void;
  onReportFailure: (id: string, reason: string, note: string) => void;
  busy: boolean;
}) {
  const [otpInput, setOtpInput] = useState('');
  const [showFailureForm, setShowFailureForm] = useState(false);
  const [failureReason, setFailureReason] = useState(FAILURE_REASONS[0].value);
  const [failureNote, setFailureNote] = useState('');

  const isFailed = d.order.status === 'FAILED';
  const nextAction = !d.pickedUpAt
    ? { label: 'Mark Picked Up', action: 'PICKED_UP' }
    : !d.outForDeliveryAt
    ? { label: 'Out for Delivery', action: 'OUT_FOR_DELIVERY' }
    : !d.arrivedAt
    ? { label: "I've Arrived", action: 'ARRIVED' }
    : !d.deliveredAt
    ? { label: 'Mark Delivered', action: 'DELIVERED' }
    : null;

  const paymentBadge = d.order.payment
    ? d.order.payment.status === 'PAID'
      ? '✅ Paid'
      : d.order.payment.method === 'CASH'
      ? '💵 Collect Cash'
      : '⚠️ Payment Pending'
    : '—';

  return (
    <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="text-lg font-extrabold text-brand-black">#{d.order.orderNumber}</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-primary">
            {isFailed
              ? '⚠️ Delivery Failed'
              : d.deliveredAt
              ? 'Delivered'
              : d.arrivedAt
              ? 'Arrived'
              : d.outForDeliveryAt
              ? 'Out for delivery'
              : d.pickedUpAt
              ? 'Picked up'
              : 'Assigned'}
          </p>
        </div>
        <span className="rounded-full bg-brand-grey/50 px-3 py-1 text-xs font-bold text-brand-black">
          ₹{d.order.totalRs}
        </span>
      </div>

      <p className="mb-1 text-sm text-brand-body">
        {d.order.items.map((i) => `${i.quantity}× ${i.product.name}`).join(', ')}
      </p>

      {d.order.fulfillmentType === 'DELIVERY' && (
        <p className="mb-1 text-sm text-brand-black">📍 {d.address ?? 'No address on file'}</p>
      )}
      {d.deliveryInstructions && <p className="mb-1 text-xs text-brand-body">Note: {d.deliveryInstructions}</p>}
      <p className="mb-4 text-xs font-semibold text-brand-body">{paymentBadge}</p>

      {isFailed && d.failureReason && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          Reason: {FAILURE_REASONS.find((r) => r.value === d.failureReason)?.label ?? d.failureReason}
        </p>
      )}

      {nextAction?.action === 'DELIVERED' && (
        <div className="mb-3 flex items-center gap-2">
          <input
            value={otpInput}
            onChange={(e) => setOtpInput(e.target.value)}
            placeholder="Ask customer for their 4-digit code"
            maxLength={4}
            className="flex-1 rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="flex gap-2">
        <a
          href={`tel:${d.contactPhone}`}
          className="flex-1 rounded-full border-2 border-brand-black py-3 text-center text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
        >
          📞 Call Customer
        </a>
        {nextAction && (
          <button
            onClick={() => onAct(d.id, nextAction.action, nextAction.action === 'DELIVERED' ? otpInput : undefined)}
            disabled={busy || (nextAction.action === 'DELIVERED' && otpInput.length !== 4)}
            className="flex-1 rounded-full bg-brand-primary py-3 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
          >
            {busy ? 'Updating…' : nextAction.label}
          </button>
        )}
      </div>

      {nextAction && !isFailed && (
        <button
          onClick={() => setShowFailureForm((v) => !v)}
          className="mt-3 w-full text-center text-xs font-semibold text-red-600 underline"
        >
          {showFailureForm ? 'Cancel' : "Can't complete this delivery?"}
        </button>
      )}

      {showFailureForm && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl bg-red-50 p-3">
          <select
            value={failureReason}
            onChange={(e) => setFailureReason(e.target.value)}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          >
            {FAILURE_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <input
            value={failureNote}
            onChange={(e) => setFailureNote(e.target.value)}
            placeholder="Details (optional)"
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
          <button
            onClick={() => {
              onReportFailure(d.id, failureReason, failureNote);
              setShowFailureForm(false);
            }}
            disabled={busy}
            className="rounded-full bg-red-600 py-2 text-xs font-bold uppercase text-white hover:bg-red-700 disabled:opacity-60"
          >
            Report Failed Delivery
          </button>
        </div>
      )}
    </div>
  );
}
