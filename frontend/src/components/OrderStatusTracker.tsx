'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useOrderUpdates } from '@/lib/useOrderUpdates';
import { useDeliveryLocationUpdates } from '@/lib/useDeliveryLocationUpdates';
import { api } from '@/lib/api';

// Leaflet touches `window` at import time, so it can only render client-side.
const LiveDeliveryMap = dynamic(() => import('./LiveDeliveryMap'), { ssr: false });

const STEPS = ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'ARRIVED', 'DELIVERED'];
const STEP_LABELS: Record<string, string> = {
  RECEIVED: 'Order Received',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  ASSIGNED: 'Ready',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  ARRIVED: 'Rider Arrived',
  DELIVERED: 'Delivered',
};

const FAILURE_REASON_LABELS: Record<string, string> = {
  CUSTOMER_UNAVAILABLE: 'you were unavailable',
  WRONG_ADDRESS: 'the address could not be found',
  CUSTOMER_CANCELLED: 'the order was cancelled',
  RIDER_ISSUE: 'a rider issue',
  VEHICLE_ISSUE: 'a vehicle issue',
  RESTAURANT_DELAY: 'a delay at our end',
  OTHER: 'an issue on the way',
};

const TIP_AMOUNTS = [20, 30, 50];

// Real distance from two real GPS points — the straight-line
// ("as the crow flies") distance, not a routed one, since that needs a
// paid routing API. Combined with an assumed average delivery-rider
// speed below, this gives an honest "approximately" estimate rather
// than a precise one, and is clearly labeled as such in the UI.
function haversineDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// A reasonable average for a two-wheeler doing local deliveries with
// stops/traffic — not a claim about this specific rider's actual
// speed right now, which is exactly why the UI says "approximately."
const AVG_DELIVERY_SPEED_KMH = 20;

function estimateEta(distanceKm: number): { mins: number; km: number } {
  const mins = Math.max(1, Math.round((distanceKm / AVG_DELIVERY_SPEED_KMH) * 60));
  return { mins, km: Math.round(distanceKm * 10) / 10 };
}

interface RiderInfo {
  name: string;
  avgRating: number | null;
  totalDeliveries: number;
}

export function OrderStatusTracker({ orderId, orderNumber, initialStatus }: { orderId: string; orderNumber: string; initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [live, setLive] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [destination, setDestination] = useState<{ lat: number; lng: number } | null>(null);
  const [deliveryOtp, setDeliveryOtp] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [rider, setRider] = useState<RiderInfo | null>(null);
  const [tipAmountRs, setTipAmountRs] = useState<number>(0);

  useOrderUpdates((event) => {
    if (event.orderId === orderId) {
      setStatus(event.status);
      setLive(true);
    }
  });

  useDeliveryLocationUpdates((event) => {
    if (event.orderId === orderId) setPosition({ lat: event.lat, lng: event.lng });
  });

  // Fetch the delivery details once — the OTP and failure reason don't
  // change live, only the status/position do (handled by the socket
  // hooks above), so one fetch on mount (or whenever status flips into
  // a delivery-relevant state) is enough.
  useEffect(() => {
    api
      .getOrder(orderId)
      .then((order) => {
        if (order.deliveryOrder?.deliveryOtp) setDeliveryOtp(order.deliveryOrder.deliveryOtp);
        if (order.deliveryOrder?.failureReason) setFailureReason(order.deliveryOrder.failureReason);
        if (order.deliveryOrder?.lastLat != null && order.deliveryOrder?.lastLng != null) {
          setPosition({ lat: order.deliveryOrder.lastLat, lng: order.deliveryOrder.lastLng });
        }
        if (order.deliveryOrder?.deliveryLat != null && order.deliveryOrder?.deliveryLng != null) {
          setDestination({ lat: order.deliveryOrder.deliveryLat, lng: order.deliveryOrder.deliveryLng });
        }
        if (order.deliveryOrder?.deliveryPerson?.name && order.riderStats) {
          setRider({
            name: order.deliveryOrder.deliveryPerson.name,
            avgRating: order.riderStats.avgRating,
            totalDeliveries: order.riderStats.totalDeliveries,
          });
        }
        if (order.deliveryOrder?.tipAmountRs) setTipAmountRs(Number(order.deliveryOrder.tipAmountRs));
      })
      .catch(() => undefined);
  }, [orderId, status]);

  if (status === 'FAILED') {
    return (
      <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
        <p className="mb-1 font-bold text-brand-black">Order #{orderNumber}</p>
        <p className="text-sm text-red-700">
          We couldn&apos;t complete this delivery{failureReason ? ` — ${FAILURE_REASON_LABELS[failureReason] ?? 'an issue came up'}` : ''}.
          Please contact us so we can sort this out.
        </p>
      </div>
    );
  }

  const currentIdx = STEPS.indexOf(status === 'ASSIGNED' ? 'READY' : status);
  const showRiderCard = rider && ['OUT_FOR_DELIVERY', 'ARRIVED', 'DELIVERED'].includes(status);

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-grey bg-brand-white">
      {status === 'DELIVERED' ? (
        <DeliveredBanner orderNumber={orderNumber} />
      ) : (
        <div className="p-5 pb-0">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-bold text-brand-black">Order #{orderNumber}</p>
            {live && (
              <span className="flex items-center gap-1 text-xs font-semibold text-brand-primary">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-primary" /> Live
              </span>
            )}
          </div>
        </div>
      )}

      <div className="p-5">
        {status !== 'DELIVERED' && (
          <div className="flex items-center">
            {STEPS.map((step, i) => (
              <div key={step} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                      i <= currentIdx ? 'bg-brand-primary text-brand-white' : 'bg-brand-grey text-brand-body'
                    }`}
                  >
                    {i <= currentIdx ? '✓' : i + 1}
                  </div>
                  <p className="mt-1 max-w-[70px] text-center text-[10px] font-semibold uppercase text-brand-body">
                    {STEP_LABELS[step]}
                  </p>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`mx-1 h-0.5 flex-1 ${i < currentIdx ? 'bg-brand-primary' : 'bg-brand-grey'}`} />
                )}
              </div>
            ))}
          </div>
        )}

        {(status === 'OUT_FOR_DELIVERY' || status === 'ARRIVED') && deliveryOtp && (
          <div className="mt-4 rounded-xl bg-brand-black p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-brand-grey">Give this code to your rider at handover</p>
            <p className="text-2xl font-extrabold tracking-widest text-brand-accent">{deliveryOtp}</p>
          </div>
        )}

        {showRiderCard && <RiderCard rider={rider} spaceBelow={status === 'OUT_FOR_DELIVERY'} />}

        {status === 'OUT_FOR_DELIVERY' && position && destination && (
          <EtaBanner position={position} destination={destination} />
        )}

        {status === 'OUT_FOR_DELIVERY' && position && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-body">Your Panda is on the way 🐼🛵</p>
            <LiveDeliveryMap lat={position.lat} lng={position.lng} />
          </div>
        )}

        {status === 'DELIVERED' && rider && (
          <TipCard orderId={orderId} rider={rider} alreadyTippedRs={tipAmountRs} onTipped={setTipAmountRs} />
        )}
      </div>
    </div>
  );
}

function DeliveredBanner({ orderNumber }: { orderNumber: string }) {
  return (
    <div className="bg-gradient-to-br from-brand-primary to-brand-accent px-5 py-8 text-center">
      <p className="mb-2 text-4xl">🐼📦</p>
      <p className="text-xl font-extrabold text-brand-white">Delivered!</p>
      <p className="mt-1 text-sm text-brand-white/90">Order #{orderNumber} — enjoy your fuel.</p>
    </div>
  );
}

function EtaBanner({ position, destination }: { position: { lat: number; lng: number }; destination: { lat: number; lng: number } }) {
  const distanceKm = haversineDistanceKm(position, destination);
  const { mins, km } = estimateEta(distanceKm);

  return (
    <div className="mb-4 rounded-xl bg-gradient-to-r from-brand-primary to-brand-accent p-4 text-center text-brand-white">
      <p className="text-lg font-extrabold">Arriving in ~{mins} min{mins !== 1 ? 's' : ''}</p>
      <p className="text-xs text-brand-white/90">~{km} km away · updates live as your rider moves</p>
    </div>
  );
}

function RiderCard({ rider, spaceBelow }: { rider: RiderInfo; spaceBelow: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-xl border border-brand-grey bg-brand-bg p-3 ${spaceBelow ? 'mb-4' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary text-lg text-brand-white">🛵</div>
        <div>
          <p className="text-sm font-bold text-brand-black">{rider.name}</p>
          <p className="text-xs text-brand-body">
            {rider.avgRating != null && <span className="mr-2">⭐ {rider.avgRating.toFixed(1)}</span>}
            {rider.totalDeliveries > 0 && <span>{rider.totalDeliveries}+ delivered</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function TipCard({
  orderId,
  rider,
  alreadyTippedRs,
  onTipped,
}: {
  orderId: string;
  rider: RiderInfo;
  alreadyTippedRs: number;
  onTipped: (amountRs: number) => void;
}) {
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tip = async (amountRs: number) => {
    setError(null);
    setBusy(true);
    try {
      await api.tipDeliveryPerson(orderId, amountRs);
      onTipped(amountRs);
    } catch (err: any) {
      setError(err.message ?? 'Could not send tip — you can also thank them in person next time.');
    } finally {
      setBusy(false);
    }
  };

  if (alreadyTippedRs > 0) {
    return (
      <div className="mt-4 rounded-xl bg-brand-bg p-4 text-center">
        <p className="text-sm font-bold text-brand-black">🙏 You tipped {rider.name} ₹{alreadyTippedRs}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-brand-grey p-4">
      <p className="mb-1 text-sm font-bold text-brand-black">Thank your delivery partner</p>
      <p className="mb-3 text-xs text-brand-body">Leave {rider.name} a tip — paid from your wallet balance.</p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {TIP_AMOUNTS.map((amt) => (
          <button
            key={amt}
            onClick={() => tip(amt)}
            disabled={busy}
            className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold text-brand-black hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
          >
            ₹{amt}
          </button>
        ))}
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))}
          placeholder="Other"
          className="w-16 rounded-full border-2 border-brand-grey px-3 py-2 text-center text-xs text-brand-black"
        />
        {custom && (
          <button
            onClick={() => tip(Number(custom))}
            disabled={busy}
            className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold text-brand-white hover:bg-brand-accent disabled:opacity-60"
          >
            {busy ? '…' : `Tip ₹${custom}`}
          </button>
        )}
      </div>
    </div>
  );
}
