'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  totalRs: string;
  createdAt: string;
  items: { quantity: number; product: { name: string } }[];
  payment: { method: string; status: string } | null;
}

interface CustomerDetail {
  id: string;
  name: string;
  goal: string | null;
  address: string | null;
  gymName: string | null;
  user: { phone: string | null; email: string | null; isActive: boolean };
  streak: { currentStreakDays: number; longestStreakDays: number } | null;
  pointsBalance: { balance: number } | null;
  allergies: { allergen: { name: string } }[];
  orders: OrderRow[];
  totalSpendRs: number;
  totalOrderCount: number;
  avgOrderValueRs: number;
  favouriteProduct: { id: string; name: string } | null;
  xpLevel: { xp: number; level: number; name: string; icon: string };
  activeMembership: { id: string; status: string; totalDays: number; daysCompleted: number } | null;
  reviews: { id: string; rating: number; comment: string | null; product: { name: string }; createdAt: string }[];
  supportTickets: { id: string; subject: string; status: string; createdAt: string }[];
}

export default function AdminCustomerDetailPage() {
  const params = useParams();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingActive, setTogglingActive] = useState(false);

  useEffect(() => {
    api
      .adminCustomerDetail(params.id as string)
      .then(setCustomer)
      .catch((err) => setError(err.message));
  }, [params.id]);

  const toggleActive = async () => {
    if (!customer) return;
    const nextActive = !customer.user.isActive;
    if (!nextActive && !window.confirm(`Block ${customer.name}? They will be logged out immediately and unable to log back in until unblocked.`)) {
      return;
    }
    setTogglingActive(true);
    try {
      await api.adminSetCustomerActive(customer.id, nextActive);
      setCustomer({ ...customer, user: { ...customer.user, isActive: nextActive } });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTogglingActive(false);
    }
  };

  if (error) return <p className="text-sm text-brand-body">Couldn&apos;t load this customer. ({error})</p>;
  if (!customer) return <p className="text-sm text-brand-body">Loading…</p>;

  return (
    <div>
      <a href="/admin/customers" className="mb-4 inline-block text-xs font-semibold text-brand-body underline">← Back to Customers</a>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">
          {customer.name}
          {!customer.user.isActive && (
            <span className="ml-3 rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase text-red-700">Blocked</span>
          )}
        </h1>
        <button
          onClick={toggleActive}
          disabled={togglingActive}
          className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide disabled:opacity-60 ${
            customer.user.isActive ? 'border-2 border-red-600 text-red-600 hover:bg-red-50' : 'bg-brand-primary text-brand-white hover:bg-brand-accent'
          }`}
        >
          {togglingActive ? 'Working…' : customer.user.isActive ? 'Block Customer' : 'Unblock Customer'}
        </button>
      </div>

      {/* Customer 360 — the single-glance summary the department spec
          asked for: spend, AOV, favourite product, membership, points,
          streak, all assembled in one place rather than scattered
          across separate pages. */}
      <div className="mb-6 grid grid-cols-2 gap-3 rounded-2xl border border-brand-grey bg-brand-white p-5 sm:grid-cols-4">
        <Stat label="Total Orders" value={String(customer.totalOrderCount)} />
        <Stat label="Lifetime Spend" value={`₹${customer.totalSpendRs.toLocaleString()}`} />
        <Stat label="Average Order" value={`₹${customer.avgOrderValueRs.toFixed(0)}`} />
        <Stat label="Membership" value={customer.activeMembership ? `Active (${customer.activeMembership.daysCompleted}/${customer.activeMembership.totalDays}d)` : 'None'} />
        <Stat label="Loyalty Points" value={String(customer.pointsBalance?.balance ?? 0)} />
        <Stat label={`Level ${customer.xpLevel.level}`} value={`${customer.xpLevel.icon} ${customer.xpLevel.name}`} />
        <Stat label="Current Streak" value={`${customer.streak?.currentStreakDays ?? 0} days`} />
        <Stat label="Favourite Product" value={customer.favouriteProduct?.name ?? '—'} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Contact & Location</h2>
          <p className="mb-1 text-sm text-brand-black">📞 {customer.user.phone ?? '—'}</p>
          <p className="mb-1 text-sm text-brand-black">✉️ {customer.user.email ?? '—'}</p>
          <p className="mb-1 text-sm text-brand-black">📍 {customer.address ?? 'No address on file'}</p>
          {customer.gymName && <p className="text-sm text-brand-black">🏋️ {customer.gymName}</p>}
        </div>

        <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Profile</h2>
          <p className="mb-1 text-sm text-brand-black">🎯 Goal: {customer.goal ?? 'Not set'}</p>
          <p className="mb-1 text-sm text-brand-black">🔥 Streak: {customer.streak?.currentStreakDays ?? 0} days (best {customer.streak?.longestStreakDays ?? 0})</p>
          <p className="mb-1 text-sm text-brand-black">🪙 Points: {customer.pointsBalance?.balance ?? 0}</p>
          {customer.allergies.length > 0 && (
            <p className="text-sm text-brand-black">⚠️ Allergies: {customer.allergies.map((a) => a.allergen.name).join(', ')}</p>
          )}
        </div>
      </div>

      <h2 className="mb-3 text-lg font-extrabold uppercase tracking-tight text-brand-black">Food & Order History</h2>
      {customer.orders.length === 0 ? (
        <p className="text-sm text-brand-body">No orders yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {customer.orders.map((order) => (
            <div key={order.id} className="rounded-2xl border border-brand-grey bg-brand-white p-4">
              <div className="mb-1 flex items-center justify-between">
                <p className="font-bold text-brand-black">#{order.orderNumber}</p>
                <span className="rounded-full bg-brand-grey/50 px-3 py-1 text-xs font-bold uppercase text-brand-black">
                  {order.status.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="mb-1 text-xs text-brand-body">{new Date(order.createdAt).toLocaleString()}</p>
              <p className="text-sm text-brand-body">
                {order.items.map((i) => `${i.quantity}× ${i.product.name}`).join(', ')}
              </p>
              <p className="mt-1 text-sm font-bold text-brand-black">₹{order.totalRs}</p>
            </div>
          ))}
        </div>
      )}

      {customer.reviews.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Reviews</h2>
          <div className="flex flex-col gap-2">
            {customer.reviews.map((r) => (
              <div key={r.id} className="rounded-xl border border-brand-grey bg-brand-white p-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-bold text-brand-black">{r.product.name}</span>
                  <span className="text-xs text-brand-body">{'⭐'.repeat(r.rating)}</span>
                </div>
                {r.comment && <p className="text-sm text-brand-body">{r.comment}</p>}
                <p className="mt-1 text-xs text-brand-body">{new Date(r.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {customer.supportTickets.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Support Tickets</h2>
          <div className="flex flex-col gap-2">
            {customer.supportTickets.map((t) => (
              <a
                key={t.id}
                href="/admin/support-tickets"
                className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white p-4 hover:border-brand-primary"
              >
                <div>
                  <p className="text-sm font-bold text-brand-black">{t.subject}</p>
                  <p className="text-xs text-brand-body">{new Date(t.createdAt).toLocaleDateString()}</p>
                </div>
                <span className="rounded-full bg-brand-bg px-2 py-1 text-xs font-bold uppercase text-brand-body">{t.status}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-brand-body">{label}</p>
      <p className="text-sm font-bold text-brand-black">{value}</p>
    </div>
  );
}
