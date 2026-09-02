'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useOrderUpdates } from '@/lib/useOrderUpdates';

interface Addon {
  addon: { name: string };
}

interface Item {
  id: string;
  quantity: number;
  product: { name: string };
  addons: Addon[];
  specialInstructions: string | null;
}

interface Allergy {
  allergen: { name: string };
}

interface KitchenOrder {
  id: string;
  orderNumber: string;
  status: 'RECEIVED' | 'ACCEPTED' | 'PREPARING' | 'READY' | string;
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  createdAt: string;
  items: Item[];
  customer: { name: string; allergies: Allergy[] };
}

const COLUMNS: { status: KitchenOrder['status']; title: string; next: KitchenOrder['status'] | null; nextLabel: string }[] = [
  { status: 'RECEIVED', title: 'New', next: 'ACCEPTED', nextLabel: 'Accept' },
  { status: 'ACCEPTED', title: 'Accepted', next: 'PREPARING', nextLabel: 'Start Preparing' },
  { status: 'PREPARING', title: 'Preparing', next: 'READY', nextLabel: 'Mark Ready' },
  { status: 'READY', title: 'Ready', next: null, nextLabel: '' },
];

function useElapsed(since: string) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export default function KitchenDisplayPage() {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState<string | null>(null);

  const load = () => {
    api.adminKitchenQueue().then(setOrders).catch((err) => setError(err.message));
  };

  useEffect(load, []);
  // Live push on any order status change, so a rider/register action
  // elsewhere shows up here instantly — falls back to nothing but the
  // initial fetch if the socket isn't connected for some reason.
  useOrderUpdates(load);

  const byColumn = useMemo(() => {
    const map: Record<string, KitchenOrder[]> = { RECEIVED: [], ACCEPTED: [], PREPARING: [], READY: [] };
    for (const o of orders) {
      if (map[o.status]) map[o.status].push(o);
    }
    return map;
  }, [orders]);

  const advance = async (order: KitchenOrder, next: string) => {
    setAdvancing(order.id);
    setError(null);
    try {
      await api.adminUpdateOrderStatus(order.id, next);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdvancing(null);
    }
  };

  return (
    <div className="min-h-screen bg-brand-black px-4 py-6 text-brand-white">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight">🐼 Kitchen</h1>
        <a href="/admin" className="text-xs font-semibold uppercase tracking-wide text-brand-grey hover:text-brand-accent">
          ← Full Admin Dashboard
        </a>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-900/50 p-3 text-sm text-red-200">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.status} className="rounded-2xl bg-brand-white/5 p-3">
            <h2 className="mb-3 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-brand-accent">
              {col.title}
              <span className="rounded-full bg-brand-white/10 px-2 py-0.5 text-brand-white">{byColumn[col.status]?.length ?? 0}</span>
            </h2>
            <div className="flex flex-col gap-3">
              {byColumn[col.status]?.map((order) => (
                <KitchenCard
                  key={order.id}
                  order={order}
                  next={col.next}
                  nextLabel={col.nextLabel}
                  busy={advancing === order.id}
                  onAdvance={() => col.next && advance(order, col.next)}
                />
              ))}
              {(byColumn[col.status]?.length ?? 0) === 0 && (
                <p className="text-xs text-brand-grey">Nothing here.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KitchenCard({
  order,
  next,
  nextLabel,
  busy,
  onAdvance,
}: {
  order: KitchenOrder;
  next: string | null;
  nextLabel: string;
  busy: boolean;
  onAdvance: () => void;
}) {
  const elapsed = useElapsed(order.createdAt);
  const hasAllergy = order.customer.allergies.length > 0;

  return (
    <div className="rounded-xl bg-brand-white p-3 text-brand-black">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-extrabold">#{order.orderNumber}</span>
        <span className="rounded-full bg-brand-black px-2 py-0.5 text-xs font-bold text-brand-accent">{elapsed}</span>
      </div>
      <p className="mb-2 text-xs text-brand-body">
        {order.fulfillmentType === 'DELIVERY' ? '🛵 Delivery' : '🏪 Pickup'} · {order.customer.name}
      </p>

      {hasAllergy && (
        <p className="mb-2 rounded-lg bg-red-100 px-2 py-1 text-xs font-bold text-red-700">
          ⚠️ {order.customer.allergies.map((a) => a.allergen.name).join(', ')} allergy
        </p>
      )}

      <ul className="mb-3 flex flex-col gap-1">
        {order.items.map((item) => (
          <li key={item.id} className="text-sm">
            <span className="font-semibold">{item.quantity}× {item.product.name}</span>
            {item.addons.length > 0 && (
              <ul className="ml-4 text-xs text-brand-body">
                {item.addons.map((a, i) => (
                  <li key={i}>- {a.addon.name}</li>
                ))}
              </ul>
            )}
            {item.specialInstructions && (
              <p className="ml-4 text-xs font-bold text-red-600">⚠ {item.specialInstructions}</p>
            )}
          </li>
        ))}
      </ul>

      {next && (
        <button
          onClick={onAdvance}
          disabled={busy}
          className="w-full rounded-full bg-brand-primary py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
        >
          {busy ? 'Updating…' : nextLabel}
        </button>
      )}
    </div>
  );
}
