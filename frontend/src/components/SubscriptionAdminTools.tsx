'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { SubscriptionStatementData } from '@/components/SubscriptionStatement';

interface HistoryRow {
  name: string;
  quantity: string;
  amountRs: string;
}

export interface EditingEntry {
  entryId: string;
  date: string;
  items: { name: string; quantity: number; amountRs: number }[];
  note: string;
}

function shopDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Change the customer's current plan: name, prices, days, the day it began, or the wallet credit. */
export function PlanEditor({
  customerId,
  statement,
  onDone,
  onCancel,
}: {
  customerId: string;
  statement: SubscriptionStatementData;
  onDone: () => void;
  onCancel: () => void;
}) {
  const sub = statement.subscription!;
  const [planName, setPlanName] = useState(sub.planName);
  const [priceRs, setPriceRs] = useState(String(sub.priceRs));
  const [packageFeeRs, setPackageFeeRs] = useState(String(sub.packageFeeRs));
  const [creditRs, setCreditRs] = useState(String(sub.creditRs));
  const [validityDays, setValidityDays] = useState(String(sub.validityDays));
  const [startDate, setStartDate] = useState(shopDate(new Date(sub.startedAt)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.posUpdateSubscription(customerId, {
        planName,
        priceRs: Number(priceRs),
        packageFeeRs: Number(packageFeeRs || 0),
        creditRs: Number(creditRs),
        validityDays: Number(validityDays),
        startDate,
      });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const field = 'mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm font-normal text-brand-black';
  return (
    <div className="rounded-2xl border-2 border-brand-primary bg-brand-white p-4">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Edit plan details</h3>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs font-bold uppercase text-brand-body">
          Plan name
          <input value={planName} onChange={(e) => setPlanName(e.target.value)} className={field} />
        </label>
        <label className="text-xs font-bold uppercase text-brand-body">
          Price ₹
          <input type="number" value={priceRs} onChange={(e) => setPriceRs(e.target.value)} className={field} />
        </label>
        <label className="text-xs font-bold uppercase text-brand-body">
          Package + delivery ₹
          <input type="number" value={packageFeeRs} onChange={(e) => setPackageFeeRs(e.target.value)} className={field} />
        </label>
        <label className="text-xs font-bold uppercase text-brand-body">
          Food credit ₹
          <input type="number" value={creditRs} onChange={(e) => setCreditRs(e.target.value)} className={field} />
        </label>
        <label className="text-xs font-bold uppercase text-brand-body">
          Days
          <input type="number" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} className={field} />
        </label>
        <label className="col-span-2 text-xs font-bold uppercase text-brand-body">
          Plan started on
          <input type="date" value={startDate} max={shopDate(new Date())} onChange={(e) => setStartDate(e.target.value)} className={field} />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-brand-body">
        Changing the food credit moves the customer&apos;s balance by the difference. Changing the start date or days moves the plan&apos;s end date.
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={saving} className="flex-1 rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onCancel} className="rounded-full border-2 border-brand-grey px-4 py-2 text-xs font-bold uppercase text-brand-body">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Add a past purchase (or fix one already added). It reduces the balance and counts toward spending like a real order. */
export function HistoryEditor({
  customerId,
  statement,
  editing,
  onDone,
  onCancel,
}: {
  customerId: string;
  statement: SubscriptionStatementData;
  editing: EditingEntry | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const sub = statement.subscription!;
  const today = shopDate(new Date());
  const [date, setDate] = useState(editing?.date ?? today);
  const [note, setNote] = useState(editing?.note ?? '');
  const [rows, setRows] = useState<HistoryRow[]>(
    editing
      ? editing.items.map((i) => ({ name: i.name, quantity: String(i.quantity), amountRs: String(i.amountRs) }))
      : [{ name: '', quantity: '1', amountRs: '' }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRow = (idx: number, patch: Partial<HistoryRow>) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const total = rows.reduce((sum, r) => sum + (Number(r.amountRs) || 0), 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    const payload = {
      date,
      note,
      items: rows.map((r) => ({ name: r.name, quantity: Number(r.quantity || 1), amountRs: Number(r.amountRs) })),
    };
    try {
      if (editing) await api.posUpdateHistory(editing.entryId, payload);
      else await api.posAddHistory(customerId, payload);
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const small = 'rounded-lg border border-brand-grey px-2 py-1.5 text-sm text-brand-black';
  return (
    <div className="rounded-2xl border-2 border-brand-primary bg-brand-white p-4">
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-brand-black">{editing ? 'Edit past purchase' : 'Add a past purchase'}</h3>
      <p className="mb-3 text-[11px] text-brand-body">
        For a customer who bought before this system, or a bill that was never rung through the app. Plan dates: {shopDate(new Date(sub.startedAt))} to {shopDate(new Date(sub.endsAt))}.
      </p>

      <label className="mb-3 block text-xs font-bold uppercase text-brand-body">
        Date
        <input
          type="date"
          value={date}
          min={shopDate(new Date(sub.startedAt))}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm font-normal text-brand-black"
        />
      </label>

      <div className="mb-2 flex flex-col gap-2">
        {rows.map((r, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input value={r.name} onChange={(e) => setRow(idx, { name: e.target.value })} placeholder="Item (e.g. NutriPlate 4 set)" className={`${small} flex-1`} />
            <input type="number" value={r.quantity} onChange={(e) => setRow(idx, { quantity: e.target.value })} className={`${small} w-14`} title="Quantity" />
            <input type="number" value={r.amountRs} onChange={(e) => setRow(idx, { amountRs: e.target.value })} placeholder="₹" className={`${small} w-20`} title="Amount for this line" />
            {rows.length > 1 && (
              <button onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))} className="text-red-600" aria-label="Remove item">
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <button onClick={() => setRows((prev) => [...prev, { name: '', quantity: '1', amountRs: '' }])} className="mb-3 text-xs font-bold text-brand-primary underline">
        + Add another item
      </button>

      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={`${small} mb-3 w-full`} />

      <p className="mb-2 text-sm font-bold text-brand-black">Total to take from balance: ₹{total}</p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving || total <= 0} className="flex-1 rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50">
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add to history'}
        </button>
        <button onClick={onCancel} className="rounded-full border-2 border-brand-grey px-4 py-2 text-xs font-bold uppercase text-brand-body">
          Cancel
        </button>
      </div>
    </div>
  );
}
