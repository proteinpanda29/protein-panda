'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Overview {
  totalSalesRs: number;
  orderCount: number;
  newCustomers: number;
  ordersByChannel: Record<string, number>;
  ordersByStatus: Record<string, number>;
  ordersByPaymentMethod: Record<string, number>;
  pendingOrderCount: number;
  yesterdayTotalSalesRs: number;
  yesterdayOrderCount: number;
}

interface LowStockItem {
  id: string;
  quantityOnHand: string;
  reorderLevel: string;
  ingredient: { name: string };
}

export default function AdminOverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    Promise.all([api.adminOverview(), api.adminLowStock()])
      .then(([o, l]) => {
        setOverview(o);
        setLowStock(l);
      })
      .catch((err) => setError(err.message));
    api.getShopStatus().then((s) => setIsOpen(s.isOpen)).catch(() => undefined);
  }, []);

  const toggleShop = async () => {
    setToggling(true);
    try {
      const updated = await api.adminToggleShop();
      setIsOpen(updated.isOpen);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setToggling(false);
    }
  };

  if (error) {
    return (
      <div className="rounded-2xl border border-brand-grey bg-brand-white p-6 text-sm text-brand-body">
        Couldn&apos;t load the admin dashboard — make sure you&apos;re logged in with an admin account. ({error})
      </div>
    );
  }

  if (!overview) return <p className="text-sm text-brand-body">Loading today&apos;s numbers…</p>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Today&apos;s Overview</h1>
        {isOpen !== null && (
          <button
            onClick={toggleShop}
            disabled={toggling}
            className={`rounded-full px-6 py-3 text-sm font-bold uppercase tracking-wide shadow-sm disabled:opacity-60 ${
              isOpen ? 'bg-brand-primary text-brand-white hover:bg-red-600' : 'bg-brand-grey/60 text-brand-black hover:bg-brand-primary hover:text-brand-white'
            }`}
            title={isOpen ? 'Click to close the shop — customers will not be able to order' : 'Click to open the shop'}
          >
            {toggling ? '...' : isOpen ? '🟢 Shop is OPEN — click to close' : '🔴 Shop is CLOSED — click to open'}
          </button>
        )}
      </div>

      {overview.pendingOrderCount > 0 && (
        <a
          href="/admin/orders"
          className="mb-6 flex items-center justify-between rounded-2xl border-2 border-brand-primary bg-brand-primary/10 px-5 py-4 text-sm font-bold text-brand-black hover:bg-brand-primary/20"
        >
          <span>
            ⚡ {overview.pendingOrderCount} order{overview.pendingOrderCount === 1 ? '' : 's'} need your attention right now
          </span>
          <span className="text-brand-primary">View Orders →</span>
        </a>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Sales Today"
          value={`₹${overview.totalSalesRs.toLocaleString()}`}
          comparison={compare(overview.totalSalesRs, overview.yesterdayTotalSalesRs)}
        />
        <Stat
          label="Orders Today"
          value={String(overview.orderCount)}
          comparison={compare(overview.orderCount, overview.yesterdayOrderCount)}
        />
        <Stat label="New Customers" value={String(overview.newCustomers)} />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        <BreakdownCard title="Orders by Channel" data={overview.ordersByChannel} />
        <BreakdownCard title="Orders by Status" data={overview.ordersByStatus} />
        <BreakdownCard title="Payment Method" data={overview.ordersByPaymentMethod} />
      </div>

      <div className="rounded-2xl border border-brand-grey bg-brand-white p-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">⚠️ Low Stock</h2>
        {lowStock.length === 0 ? (
          <p className="text-sm text-brand-body">All ingredients are above reorder level.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lowStock.map((item) => (
              <li key={item.id} className="flex justify-between text-sm">
                <span className="text-brand-black">{item.ingredient.name}</span>
                <span className="text-brand-body">
                  {item.quantityOnHand} on hand · reorder at {item.reorderLevel}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function compare(today: number, yesterday: number): string | null {
  // No comparison shown at all if yesterday had nothing — "+∞%" or
  // "-100%" against a zero baseline is misleading noise, not a useful
  // signal, so it's better to just omit it than show something
  // technically-correct-but-confusing.
  if (yesterday === 0) return null;
  const pctChange = Math.round(((today - yesterday) / yesterday) * 100);
  if (pctChange === 0) return 'same as yesterday';
  return `${pctChange > 0 ? '↑' : '↓'} ${Math.abs(pctChange)}% vs yesterday`;
}

function Stat({ label, value, comparison }: { label: string; value: string; comparison?: string | null }) {
  return (
    <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-body">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-brand-black">{value}</p>
      {comparison && (
        <p className={`mt-1 text-xs font-semibold ${comparison.startsWith('↑') ? 'text-green-600' : comparison.startsWith('↓') ? 'text-red-600' : 'text-brand-body'}`}>
          {comparison}
        </p>
      )}
    </div>
  );
}

function BreakdownCard({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data);
  return (
    <div className="rounded-2xl border border-brand-grey bg-brand-white p-6">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-brand-body">No orders yet today.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map(([key, count]) => (
            <li key={key} className="flex items-center justify-between text-sm">
              <span className="text-brand-body">{key}</span>
              <span className="font-bold text-brand-black">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
