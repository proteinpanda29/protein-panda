'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface CustomerRow {
  id: string;
  name: string;
  goal: string | null;
  user: { phone: string | null; email: string | null };
  streak: { currentStreakDays: number } | null;
  pointsBalance: { balance: number } | null;
  _count: { orders: number };
}

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      api
        .adminCustomers(search || undefined)
        .then(setCustomers)
        .catch((err) => setError(err.message));
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Customers</h1>
        <input
          placeholder="Search by name, phone, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-brand-grey bg-brand-white px-3 py-2 text-sm text-brand-black"
        />
      </div>

      {error && <p className="text-sm text-brand-body">Couldn&apos;t load customers. ({error})</p>}

      <div className="overflow-hidden rounded-2xl border border-brand-grey bg-brand-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-black text-brand-white">
            <tr>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Name</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Contact</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Goal</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">🔥 Streak</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">🪙 Points</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Orders</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr
                key={c.id}
                onClick={() => (window.location.href = `/admin/customers/${c.id}`)}
                className="cursor-pointer border-t border-brand-grey hover:bg-brand-bg"
              >
                <td className="px-4 py-3 font-semibold text-brand-black">{c.name}</td>
                <td className="px-4 py-3 text-brand-body">{c.user.phone ?? c.user.email ?? '—'}</td>
                <td className="px-4 py-3 text-brand-body">{c.goal ?? '—'}</td>
                <td className="px-4 py-3 text-brand-body">{c.streak?.currentStreakDays ?? 0} days</td>
                <td className="px-4 py-3 text-brand-body">{c.pointsBalance?.balance ?? 0}</td>
                <td className="px-4 py-3 text-brand-body">{c._count.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.length === 0 && <p className="p-4 text-sm text-brand-body">No customers found.</p>}
      </div>
    </div>
  );
}
