'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Product {
  id: string;
  name: string;
  basePriceRs: string;
}

interface MembershipItem {
  id: string;
  quantity: number;
  product: { name: string };
}

interface Membership {
  id: string;
  totalDays: number;
  daysCompleted: number;
  scheduledTime: string;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  items: MembershipItem[];
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-brand-primary text-brand-white',
  PAUSED: 'bg-yellow-100 text-yellow-800',
  CANCELLED: 'bg-brand-grey/50 text-brand-black',
  COMPLETED: 'bg-brand-black text-brand-white',
};

export default function MembershipPage() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [totalDays, setTotalDays] = useState<7 | 30>(7);
  const [scheduledTime, setScheduledTime] = useState('08:30');
  const [fulfillmentType, setFulfillmentType] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryContactPhone, setDeliveryContactPhone] = useState('');
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});

  const load = () => {
    api
      .myMemberships()
      .then(setMemberships)
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);
  useEffect(() => {
    api.listProducts().then(setProducts).catch(() => undefined);
  }, []);

  const toggleItem = (productId: string) => {
    setSelectedItems((prev) => {
      const next = { ...prev };
      if (next[productId]) delete next[productId];
      else next[productId] = 1;
      return next;
    });
  };

  const createPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const items = Object.entries(selectedItems).map(([productId, quantity]) => ({ productId, quantity }));
    if (items.length === 0) {
      setError('Pick at least one item for the plan');
      return;
    }
    if (fulfillmentType === 'DELIVERY' && (!deliveryAddress.trim() || !deliveryContactPhone.trim())) {
      setError('A delivery address and contact phone are required for a delivery plan');
      return;
    }
    try {
      await api.createMembership({
        totalDays,
        scheduledTime,
        fulfillmentType,
        items,
        ...(fulfillmentType === 'DELIVERY' ? { deliveryAddress, deliveryContactPhone } : {}),
      });
      setShowForm(false);
      setSelectedItems({});
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const act = async (id: string, action: 'pause' | 'resume' | 'cancel' | 'skip') => {
    setBusy(id);
    try {
      if (action === 'pause') await api.pauseMembership(id);
      else if (action === 'resume') await api.resumeMembership(id);
      else if (action === 'cancel') await api.cancelMembership(id);
      else if (action === 'skip') await api.skipNextMembership(id);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (error && memberships.length === 0 && !showForm) {
    return (
      <section className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-4 text-sm text-brand-body">
          Couldn&apos;t load your memberships — make sure you&apos;re logged in. ({error})
        </p>
        <a href="/login" className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent">
          Go to Login
        </a>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">My Membership</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          {showForm ? 'Cancel' : '+ New Plan'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createPlan} className="mb-8 rounded-2xl border border-brand-grey bg-brand-white p-5">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Plan Length</p>
          <div className="mb-4 flex gap-2">
            {[7, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setTotalDays(d as 7 | 30)}
                className={`flex-1 rounded-full border-2 py-2 text-sm font-bold ${
                  totalDays === d ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
                }`}
              >
                {d === 7 ? '7 Days (Weekly)' : '30 Days (Monthly)'}
              </button>
            ))}
          </div>

          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Daily Items</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleItem(p.id)}
                className={`rounded-full border-2 px-3 py-2 text-xs font-semibold ${
                  selectedItems[p.id] ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
              Delivery time
              <input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
              Fulfillment
              <select
                value={fulfillmentType}
                onChange={(e) => setFulfillmentType(e.target.value as any)}
                className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
              >
                <option value="PICKUP">Pickup</option>
                <option value="DELIVERY">Delivery</option>
              </select>
            </label>

            {fulfillmentType === 'DELIVERY' && (
              <>
                <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
                  Delivery address
                  <textarea
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="House/flat no., street, landmark, floor…"
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
                  Contact phone
                  <input
                    type="tel"
                    value={deliveryContactPhone}
                    onChange={(e) => setDeliveryContactPhone(e.target.value)}
                    placeholder="+91 9xxxxxxxxx"
                    className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
                  />
                </label>
              </>
            )}
          </div>

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
          >
            Start Plan
          </button>
        </form>
      )}

      {memberships.length === 0 && !showForm && (
        <p className="rounded-2xl border border-brand-grey bg-brand-white p-6 text-center text-sm text-brand-body">
          No membership plans yet — start a weekly or monthly plan and skip re-ordering every day.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {memberships.map((m) => (
          <div key={m.id} className="rounded-2xl border border-brand-grey bg-brand-white p-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-bold text-brand-black">
                {m.totalDays}-Day Plan · {m.scheduledTime}
              </p>
              <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${STATUS_STYLE[m.status]}`}>
                {m.status}
              </span>
            </div>
            <p className="mb-1 text-sm text-brand-body">
              {m.items.map((i) => `${i.quantity}× ${i.product.name}`).join(', ')}
            </p>
            <p className="mb-3 text-xs text-brand-body">
              {m.daysCompleted} / {m.totalDays} days completed · {m.fulfillmentType}
            </p>

            {(m.status === 'ACTIVE' || m.status === 'PAUSED') && (
              <div className="flex flex-wrap gap-2">
                {m.status === 'ACTIVE' && (
                  <>
                    <ActionButton label="Pause" onClick={() => act(m.id, 'pause')} busy={busy === m.id} />
                    <ActionButton label="Skip Next" onClick={() => act(m.id, 'skip')} busy={busy === m.id} />
                  </>
                )}
                {m.status === 'PAUSED' && <ActionButton label="Resume" onClick={() => act(m.id, 'resume')} busy={busy === m.id} primary />}
                <ActionButton label="Cancel" onClick={() => act(m.id, 'cancel')} busy={busy === m.id} danger />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  primary,
  danger,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide disabled:opacity-60 ${
        primary
          ? 'bg-brand-primary text-brand-white hover:bg-brand-accent'
          : danger
          ? 'border-2 border-red-300 text-red-600 hover:border-red-500'
          : 'border-2 border-brand-black text-brand-black hover:border-brand-primary hover:text-brand-primary'
      }`}
    >
      {busy ? '...' : label}
    </button>
  );
}
