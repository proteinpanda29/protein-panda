'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface CostingRow {
  productId: string;
  name: string;
  priceRs: number;
  totalCostRs: number;
  grossMarginRs: number;
  grossMarginPct: number;
}

function marginStyle(pct: number) {
  if (pct < 0) return 'bg-red-100 text-red-700';
  if (pct < 20) return 'bg-yellow-100 text-yellow-800';
  return 'bg-brand-primary/10 text-brand-primary';
}

export default function AdminCostingPage() {
  const [rows, setRows] = useState<CostingRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminCostingSummary().then(setRows).catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-sm text-brand-body">Couldn&apos;t load costing. ({error})</p>;

  const risky = rows.filter((r) => r.grossMarginPct < 20).length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Product Costing</h1>
        <a href="/admin/suppliers" className="text-xs font-semibold text-brand-body underline">← Suppliers & Purchases</a>
      </div>

      <p className="mb-4 text-sm text-brand-body">
        Real food cost from your actual purchase prices, sorted worst-margin-first — the fastest way to spot a
        product a coupon or reward could push into the red.
      </p>

      {risky > 0 && (
        <p className="mb-4 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-800">
          ⚠️ {risky} product{risky > 1 ? 's have' : ' has'} a margin under 20% — worth a second look before running promotions on {risky > 1 ? 'them' : 'it'}.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-brand-grey bg-brand-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-black text-brand-white">
            <tr>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Product</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Price</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Cost</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Margin</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId} className="border-t border-brand-grey">
                <td className="px-4 py-3 font-semibold text-brand-black">
                  <a href={`/admin/products/${r.productId}`} className="hover:text-brand-primary">{r.name}</a>
                </td>
                <td className="px-4 py-3 text-brand-body">₹{r.priceRs.toFixed(2)}</td>
                <td className="px-4 py-3 text-brand-body">₹{r.totalCostRs.toFixed(2)}</td>
                <td className="px-4 py-3 text-brand-body">₹{r.grossMarginRs.toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${marginStyle(r.grossMarginPct)}`}>
                    {r.grossMarginPct.toFixed(0)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-brand-body">No active products to cost yet.</p>}
      </div>
    </div>
  );
}
