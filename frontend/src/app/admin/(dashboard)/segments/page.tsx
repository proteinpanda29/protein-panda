'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const SEGMENTS = [
  { value: 'LAPSED_30_DAYS', label: 'No Order in 30 Days', icon: '💤' },
  { value: 'HIGH_SPENDERS', label: 'Top Spenders', icon: '💰' },
  { value: 'ACTIVE_MEMBERS', label: 'Active Members', icon: '🏋️' },
  { value: 'MEMBERSHIP_EXPIRING_SOON', label: 'Membership Expiring Soon', icon: '⏰' },
  { value: 'CLOSE_TO_MONTHLY_REWARD', label: 'Close to Monthly Reward', icon: '🏆' },
] as const;

export default function SegmentsPage() {
  const [type, setType] = useState<(typeof SEGMENTS)[number]['value']>('LAPSED_30_DAYS');
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .adminGetSegment(type)
      .then(setCustomers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [type]);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Customer Segments</h1>
      <p className="mb-6 text-sm text-brand-body">Real, computed lists for targeted outreach — not estimates.</p>

      <div className="mb-6 flex flex-wrap gap-2">
        {SEGMENTS.map((s) => (
          <button
            key={s.value}
            onClick={() => setType(s.value)}
            className={`rounded-full border-2 px-4 py-2 text-xs font-bold uppercase ${
              type === s.value ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
            }`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-brand-body">Loading…</p>}
      {!loading && customers.length === 0 && !error && <p className="text-sm text-brand-body">No customers in this segment right now.</p>}

      <div className="rounded-2xl border border-brand-grey bg-brand-white">
        {customers.map((c, i) => (
          <a
            key={c.id}
            href={`/admin/customers/${c.id}`}
            className={`flex items-center justify-between px-4 py-3 hover:bg-brand-bg ${i > 0 ? 'border-t border-brand-grey' : ''}`}
          >
            <span className="text-sm font-bold text-brand-black">{c.name}</span>
            <SegmentDetail type={type} c={c} />
          </a>
        ))}
      </div>
    </div>
  );
}

function SegmentDetail({ type, c }: { type: string; c: any }) {
  if (type === 'LAPSED_30_DAYS') return <span className="text-xs text-brand-body">Last order: {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : '—'}</span>;
  if (type === 'HIGH_SPENDERS') return <span className="text-xs font-bold text-brand-black">₹{c.totalSpendRs.toLocaleString()}</span>;
  if (type === 'MEMBERSHIP_EXPIRING_SOON') return <span className="text-xs text-brand-body">Ends {new Date(c.endDate).toLocaleDateString()}</span>;
  if (type === 'CLOSE_TO_MONTHLY_REWARD') return <span className="text-xs text-brand-body">{c.visitsThisMonth}/15 visits</span>;
  return null;
}
