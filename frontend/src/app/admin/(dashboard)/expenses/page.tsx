'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ExpenseRow {
  id: string;
  category: string;
  amountRs: string;
  description: string;
  expenseDate: string;
  paymentMethod: string | null;
  createdByUser: { staff: { name: string } | null } | null;
}

const CATEGORIES = ['PURCHASE', 'OPERATING', 'STAFF', 'DELIVERY', 'MARKETING', 'EQUIPMENT', 'OTHER'];

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  return { from, to };
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [summary, setSummary] = useState<{ totalRs: number; byCategory: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { from, to } = monthRange();

  const load = () => {
    setLoading(true);
    Promise.all([api.adminListExpenses({ dateFrom: from, dateTo: to }), api.adminExpenseSummary(from, to)])
      .then(([e, s]) => {
        setExpenses(e);
        setSummary(s);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string) => {
    if (!window.confirm('Delete this expense?')) return;
    await api.adminDeleteExpense(id);
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Expenses</h1>
          <p className="text-sm text-brand-body">This month&apos;s business spend, by category.</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent"
        >
          {showForm ? 'Cancel' : '+ Record Expense'}
        </button>
      </div>

      {showForm && <NewExpenseForm onCreated={() => { setShowForm(false); load(); }} />}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {summary && (
        <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">This Month — ₹{summary.totalRs.toLocaleString()} total</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(summary.byCategory).map(([cat, amount]) => (
              <div key={cat}>
                <p className="text-[10px] font-bold uppercase text-brand-body">{cat}</p>
                <p className="text-sm font-bold text-brand-black">₹{amount.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-brand-body">Loading…</p>}
      {!loading && expenses.length === 0 && !error && <p className="text-sm text-brand-body">No expenses recorded this month yet.</p>}

      <div className="flex flex-col gap-2">
        {expenses.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white p-4">
            <div>
              <p className="text-sm font-bold text-brand-black">{e.description}</p>
              <p className="text-xs text-brand-body">
                {e.category} · {new Date(e.expenseDate).toLocaleDateString()} · {e.createdByUser?.staff?.name ?? 'Unknown'}
                {e.paymentMethod ? ` · ${e.paymentMethod}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm font-bold text-brand-black">₹{Number(e.amountRs).toLocaleString()}</p>
              <button onClick={() => remove(e.id)} className="text-xs font-bold uppercase text-red-600 hover:underline">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewExpenseForm({ onCreated }: { onCreated: () => void }) {
  const [category, setCategory] = useState('OPERATING');
  const [amountRs, setAmountRs] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!amountRs || !description) {
      setError('Amount and description are both required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.adminRecordExpense({ category, amountRs: Number(amountRs), description, paymentMethod: paymentMethod || undefined });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={amountRs}
          onChange={(e) => setAmountRs(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="Amount (₹)"
          inputMode="decimal"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2" />
        <input
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          placeholder="Payment method (optional)"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
        />
      </div>
      <button
        onClick={submit}
        disabled={saving}
        className="rounded-full bg-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-black/80 disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Record Expense'}
      </button>
    </div>
  );
}
