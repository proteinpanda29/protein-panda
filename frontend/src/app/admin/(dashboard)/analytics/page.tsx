'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Analytics {
  range: string;
  totalSalesRs: number;
  orderCount: number;
  avgOrderValueRs: number;
  discountsGivenRs: number;
  paymentBreakdown: Record<string, number>;
  hourlySales: { hour: number; totalRs: number }[] | null;
  bestSelling: { name: string; qty: number }[];
  slowMoving: { name: string; qty: number }[];
  newCustomersCount: number;
  returningCustomersCount: number;
  retentionRatePct: number;
  topCustomers: { customerId: string; name: string; totalRs: number }[];
}

const RANGES: { value: 'today' | 'week' | 'month'; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 Days' },
  { value: 'month', label: 'Last 30 Days' },
];

export default function AdminAnalyticsPage() {
  const [range, setRange] = useState<'today' | 'week' | 'month'>('today');
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminAnalytics(range)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [range]);

  if (error) return <p className="text-sm text-brand-body">Couldn&apos;t load analytics. ({error})</p>;

  const peakHour = data?.hourlySales?.reduce((max, h) => (h.totalRs > max.totalRs ? h : max), { hour: 0, totalRs: 0 });
  const maxHourlyRs = Math.max(1, ...(data?.hourlySales?.map((h) => h.totalRs) ?? [1]));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">POS Analytics</h1>
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`rounded-full px-3 py-2 text-xs font-bold uppercase tracking-wide ${
                range === r.value ? 'bg-brand-primary text-brand-white' : 'border border-brand-grey text-brand-black'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <p className="text-sm text-brand-body">Loading…</p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Total Sales" value={`₹${data.totalSalesRs.toLocaleString()}`} />
            <Stat label="Orders" value={String(data.orderCount)} />
            <Stat label="Avg Order Value" value={`₹${data.avgOrderValueRs.toFixed(0)}`} />
            <Stat label="Discounts Given" value={`₹${data.discountsGivenRs.toLocaleString()}`} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-brand-grey bg-brand-white p-6">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Payment Methods</h2>
              {Object.keys(data.paymentBreakdown).length === 0 ? (
                <p className="text-sm text-brand-body">No paid orders in this range.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {Object.entries(data.paymentBreakdown).map(([method, amount]) => (
                    <li key={method} className="flex items-center justify-between text-sm">
                      <span className="text-brand-black">{method}</span>
                      <span className="font-bold text-brand-primary">₹{amount.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {data.hourlySales && (
              <div className="rounded-2xl border border-brand-grey bg-brand-white p-6">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">
                  Sales by Hour {peakHour && peakHour.totalRs > 0 && <span className="font-normal text-brand-body">· peak {peakHour.hour}:00</span>}
                </h2>
                <div className="flex h-24 items-end gap-0.5">
                  {data.hourlySales.map((h) => (
                    <div
                      key={h.hour}
                      title={`${h.hour}:00 — ₹${h.totalRs}`}
                      className="flex-1 rounded-t bg-brand-primary"
                      style={{ height: `${Math.max((h.totalRs / maxHourlyRs) * 100, h.totalRs > 0 ? 4 : 0)}%` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <RankList title="🏆 Best Selling" items={data.bestSelling} />
            <RankList title="🐌 Slow Moving" items={data.slowMoving} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Customer Retention</h2>
              <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xl font-extrabold text-brand-black">{data.newCustomersCount}</p>
                  <p className="text-[10px] uppercase text-brand-body">New</p>
                </div>
                <div>
                  <p className="text-xl font-extrabold text-brand-black">{data.returningCustomersCount}</p>
                  <p className="text-[10px] uppercase text-brand-body">Returning</p>
                </div>
                <div>
                  <p className="text-xl font-extrabold text-brand-primary">{data.retentionRatePct.toFixed(0)}%</p>
                  <p className="text-[10px] uppercase text-brand-body">Retention</p>
                </div>
              </div>
              <p className="text-xs text-brand-body">Share of everyone who ordered in this window who had also ordered before it.</p>
            </div>

            <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">🥇 Top Customers</h2>
              {data.topCustomers.length === 0 && <p className="text-xs text-brand-body">No orders in this window yet.</p>}
              <div className="flex flex-col gap-2">
                {data.topCustomers.map((c, i) => (
                  <a
                    key={c.customerId}
                    href={`/admin/customers/${c.customerId}`}
                    className="flex items-center justify-between text-sm hover:text-brand-primary"
                  >
                    <span className="text-brand-black">{i + 1}. {c.name}</span>
                    <span className="font-bold text-brand-black">₹{c.totalRs.toLocaleString()}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-body">{label}</p>
      <p className="mt-1 text-xl font-extrabold text-brand-black">{value}</p>
    </div>
  );
}

function RankList({ title, items }: { title: string; items: { name: string; qty: number }[] }) {
  return (
    <div className="rounded-2xl border border-brand-grey bg-brand-white p-6">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-brand-body">No sales in this range yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.name} className="flex items-center justify-between text-sm">
              <span className="text-brand-black">{item.name}</span>
              <span className="font-bold text-brand-body">{item.qty} sold</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
