'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Expense {
  id: string;
  amountRs: string;
  note: string;
  createdAt: string;
}

interface CurrentShift {
  id: string;
  openingCashRs: string;
  openedAt: string;
  cashSalesRs: number;
  cashSalesCount: number;
  cashRefundsRs: number;
  cashExpensesRs: number;
  expectedCashRs: number;
  expenses: Expense[];
}

interface PastShift {
  id: string;
  openingCashRs: string;
  openedAt: string;
  closedAt: string | null;
  closingCashRs: string | null;
  expectedCashRs: string | null;
  differenceRs: string | null;
  status: 'OPEN' | 'CLOSED';
  openedByUser: { staff: { name: string } | null } | null;
  closedByUser: { staff: { name: string } | null } | null;
}

export default function AdminCashPage() {
  const [current, setCurrent] = useState<CurrentShift | null>(null);
  const [shifts, setShifts] = useState<PastShift[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [openingCash, setOpeningCash] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.adminCashCurrent().then(setCurrent).catch((err) => setError(err.message));
    api.adminCashShifts().then(setShifts).catch(() => undefined);
  };

  useEffect(load, []);

  const openShift = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.adminCashOpen(Number(openingCash));
      setOpeningCash('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addExpense = async () => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminCashExpense(current.id, Number(expenseAmount), expenseNote);
      setExpenseAmount('');
      setExpenseNote('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const closeShift = async () => {
    if (!current) return;
    if (!confirm('Close this shift? This locks in the reconciliation and cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminCashClose(current.id, Number(closingCash));
      setClosingCash('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Cash Reconciliation</h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {!current ? (
        <div className="mb-8 rounded-2xl border border-brand-grey bg-brand-white p-5">
          <p className="mb-3 text-sm text-brand-body">No shift is open. Count the drawer and open a shift to start tracking.</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Opening cash (₹)"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              className="w-48 rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
            <button
              onClick={openShift}
              disabled={busy || !openingCash}
              className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50"
            >
              {busy ? 'Opening…' : 'Open Shift'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-8 rounded-2xl border border-brand-grey bg-brand-white p-5">
          <p className="mb-4 text-xs text-brand-body">Opened {new Date(current.openedAt).toLocaleString()}</p>

          <div className="mb-4 rounded-xl bg-brand-bg p-4 text-sm">
            <div className="flex justify-between"><span className="text-brand-body">Opening cash</span><span>₹{Number(current.openingCashRs).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-brand-body">Cash sales ({current.cashSalesCount})</span><span>+₹{current.cashSalesRs.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-brand-body">Cash refunds</span><span>-₹{current.cashRefundsRs.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-brand-body">Expenses logged</span><span>-₹{current.cashExpensesRs.toFixed(2)}</span></div>
            <div className="mt-1 flex justify-between border-t border-brand-grey pt-1 font-bold">
              <span>Expected in drawer right now</span><span>₹{current.expectedCashRs.toFixed(2)}</span>
            </div>
          </div>

          <p className="mb-2 text-xs font-bold uppercase text-brand-body">Log a cash expense (e.g. emergency supply run)</p>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              type="number"
              placeholder="Amount (₹)"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              className="w-32 rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
            <input
              placeholder="What was it for?"
              value={expenseNote}
              onChange={(e) => setExpenseNote(e.target.value)}
              className="flex-1 rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
            <button
              onClick={addExpense}
              disabled={busy || !expenseAmount || !expenseNote}
              className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary disabled:opacity-50"
            >
              Log Expense
            </button>
          </div>

          {current.expenses.length > 0 && (
            <ul className="mb-4 flex flex-col gap-1 text-xs text-brand-body">
              {current.expenses.map((e) => (
                <li key={e.id}>₹{e.amountRs} — {e.note} ({new Date(e.createdAt).toLocaleTimeString()})</li>
              ))}
            </ul>
          )}

          <p className="mb-2 text-xs font-bold uppercase text-brand-body">Close shift — count the actual cash in the drawer</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Actual cash counted (₹)"
              value={closingCash}
              onChange={(e) => setClosingCash(e.target.value)}
              className="w-48 rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
            <button
              onClick={closeShift}
              disabled={busy || !closingCash}
              className="rounded-full bg-red-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Closing…' : 'Close Shift'}
            </button>
          </div>
        </div>
      )}

      <h2 className="mb-3 text-lg font-extrabold uppercase tracking-tight text-brand-black">Shift History</h2>
      <div className="overflow-hidden rounded-2xl border border-brand-grey bg-brand-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-black text-brand-white">
            <tr>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Opened</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">By</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Expected</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Actual</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Difference</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => {
              const diff = s.differenceRs !== null ? Number(s.differenceRs) : null;
              return (
                <tr key={s.id} className="border-t border-brand-grey">
                  <td className="px-4 py-3 text-brand-body">{new Date(s.openedAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-brand-body">{s.openedByUser?.staff?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-brand-body">{s.expectedCashRs !== null ? `₹${Number(s.expectedCashRs).toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 text-brand-body">{s.closingCashRs !== null ? `₹${Number(s.closingCashRs).toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3">
                    {diff !== null ? (
                      <span className={`font-bold ${diff === 0 ? 'text-brand-primary' : Math.abs(diff) > 50 ? 'text-red-600' : 'text-yellow-700'}`}>
                        {diff > 0 ? '+' : ''}₹{diff.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-xs uppercase text-brand-body">Open</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shifts.length === 0 && <p className="p-4 text-sm text-brand-body">No shifts recorded yet.</p>}
      </div>
    </div>
  );
}
