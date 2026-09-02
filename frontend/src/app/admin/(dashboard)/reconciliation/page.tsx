'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ReconciliationReport {
  salesByMethod: Record<string, { count: number; totalRs: number }>;
  refundsByMethod: Record<string, { count: number; totalRs: number }>;
  missingTransactionRefs: { id: string; method: string; order: { orderNumber: string } }[];
  stuckPendingPayments: { id: string; order: { orderNumber: string; createdAt: string } }[];
}

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  return { from, to };
}

export default function ReconciliationPage() {
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { from, to } = monthRange();

  useEffect(() => {
    api
      .adminReconciliation(from, to)
      .then(setReport)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (loading || !report) return <p className="text-sm text-brand-body">Loading…</p>;

  const hasIssues = report.missingTransactionRefs.length > 0 || report.stuckPendingPayments.length > 0;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Payment Reconciliation</h1>
      <p className="mb-6 text-sm text-brand-body">This month&apos;s sales and refunds by method, plus anything that looks off.</p>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Sales by Method</h2>
          {Object.keys(report.salesByMethod).length === 0 && <p className="text-xs text-brand-body">No sales this month yet.</p>}
          <div className="flex flex-col gap-2">
            {Object.entries(report.salesByMethod).map(([method, data]) => (
              <div key={method} className="flex items-center justify-between text-sm">
                <span className="text-brand-black">{method}</span>
                <span className="font-bold text-brand-black">
                  ₹{data.totalRs.toLocaleString()} <span className="text-xs font-normal text-brand-body">({data.count})</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">Refunds by Method</h2>
          {Object.keys(report.refundsByMethod).length === 0 && <p className="text-xs text-brand-body">No refunds this month.</p>}
          <div className="flex flex-col gap-2">
            {Object.entries(report.refundsByMethod).map(([method, data]) => (
              <div key={method} className="flex items-center justify-between text-sm">
                <span className="text-brand-black">{method}</span>
                <span className="font-bold text-brand-black">
                  ₹{data.totalRs.toLocaleString()} <span className="text-xs font-normal text-brand-body">({data.count})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!hasIssues && (
        <div className="rounded-2xl border-2 border-brand-primary bg-brand-primary/10 p-4">
          <p className="text-sm font-bold text-brand-black">✅ Nothing flagged — no missing transaction refs, no stuck payments.</p>
        </div>
      )}

      {report.missingTransactionRefs.length > 0 && (
        <div className="mb-4 rounded-2xl border-2 border-red-300 bg-red-50 p-4">
          <p className="mb-2 text-sm font-bold text-red-700">⚠ Paid online, but no transaction reference on file</p>
          {report.missingTransactionRefs.map((p) => (
            <p key={p.id} className="text-xs text-red-600">
              Order #{p.order.orderNumber} — {p.method}
            </p>
          ))}
        </div>
      )}

      {report.stuckPendingPayments.length > 0 && (
        <div className="rounded-2xl border-2 border-yellow-300 bg-yellow-50 p-4">
          <p className="mb-2 text-sm font-bold text-yellow-700">⚠ Payments pending for over 24 hours — likely abandoned</p>
          {report.stuckPendingPayments.map((p) => (
            <p key={p.id} className="text-xs text-yellow-700">
              Order #{p.order.orderNumber} — {new Date(p.order.createdAt).toLocaleString()}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
