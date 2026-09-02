'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Refund {
  id: string;
  amountRs: string;
  reason: string;
  method: 'CASH' | 'RAZORPAY';
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  razorpayRefundId: string | null;
  createdAt: string;
  completedAt: string | null;
  order: { orderNumber: string; customer: { name: string } };
  initiatedByUser: { staff: { name: string } | null } | null;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-brand-primary/10 text-brand-primary',
  FAILED: 'bg-red-100 text-red-700',
};

export default function AdminRefundsPage() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = () => {
    api.adminAllRefunds().then(setRefunds).catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const confirmCash = async (refundId: string) => {
    setConfirming(refundId);
    try {
      await api.adminConfirmCashRefund(refundId);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConfirming(null);
    }
  };

  if (error) return <p className="text-sm text-brand-body">Couldn&apos;t load refunds. ({error})</p>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Refund History</h1>
        <a href="/admin/orders" className="text-xs font-semibold text-brand-body underline">← Back to Orders</a>
      </div>

      {refunds.length === 0 ? (
        <p className="text-sm text-brand-body">No refunds yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {refunds.map((r) => (
            <div key={r.id} className="rounded-2xl border border-brand-grey bg-brand-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-brand-black">
                    #{r.order.orderNumber} · {r.order.customer.name}
                  </p>
                  <p className="text-xs text-brand-body">{r.reason}</p>
                  <p className="text-xs text-brand-body">
                    {r.method} · {new Date(r.createdAt).toLocaleString()}
                    {r.initiatedByUser?.staff?.name && ` · by ${r.initiatedByUser.staff.name}`}
                  </p>
                  {r.razorpayRefundId && <p className="text-xs text-brand-body">Gateway ref: {r.razorpayRefundId}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${STATUS_STYLE[r.status]}`}>
                    {r.status}
                  </span>
                  <span className="font-bold text-brand-black">₹{r.amountRs}</span>
                  {r.method === 'CASH' && r.status === 'PENDING' && (
                    <button
                      onClick={() => confirmCash(r.id)}
                      disabled={confirming === r.id}
                      className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
                    >
                      {confirming === r.id ? '...' : 'Confirm Cash Given'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
