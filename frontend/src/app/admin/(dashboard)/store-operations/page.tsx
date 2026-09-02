'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ChecklistItem {
  id: string;
  label: string;
  sortOrder: number;
}

interface TodayStatus {
  openingCompleted: boolean;
  closingCompleted: boolean;
  cashShiftClosed: boolean;
  isBusinessDayClosed: boolean;
  readyToClose: boolean;
}

export default function StoreOperationsPage() {
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.storeOpsTodayStatus().then(setStatus).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!status) return <p className="text-sm text-brand-body">Loading…</p>;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Store Operations</h1>
      <p className="mb-6 text-sm text-brand-body">Opening and closing checklists, and closing out the business day.</p>

      {status.isBusinessDayClosed && (
        <div className="mb-6 rounded-xl border-2 border-brand-primary bg-brand-primary/10 p-4">
          <p className="text-sm font-bold text-brand-black">✅ Today has been closed.</p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ChecklistCard type="OPENING" title="🌅 Opening Checklist" completed={status.openingCompleted} onSubmitted={load} />
        <ChecklistCard type="CLOSING" title="🌙 Closing Checklist" completed={status.closingCompleted} onSubmitted={load} />
      </div>

      <CloseBusinessDayCard status={status} onClosed={load} />
    </div>
  );
}

function ChecklistCard({
  type,
  title,
  completed,
  onSubmitted,
}: {
  type: 'OPENING' | 'CLOSING';
  title: string;
  completed: boolean;
  onSubmitted: () => void;
}) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const open = () => {
    setExpanded(true);
    if (items.length === 0) {
      api.storeOpsChecklistItems(type).then(setItems).catch((err) => setError(err.message));
    }
  };

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.storeOpsSubmitLog(
        type,
        items.map((item) => ({ checklistItemId: item.id, isCompleted: checked.has(item.id) })),
      );
      setExpanded(false);
      onSubmitted();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand-black">{title}</h2>
        {completed ? (
          <span className="rounded-full bg-brand-primary/20 px-2 py-1 text-[10px] font-bold uppercase text-brand-primary">Done Today</span>
        ) : (
          <span className="rounded-full bg-yellow-100 px-2 py-1 text-[10px] font-bold uppercase text-yellow-700">Pending</span>
        )}
      </div>

      {!expanded && (
        <button
          onClick={open}
          className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary"
        >
          {completed ? 'Submit Again' : 'Start Checklist'}
        </button>
      )}

      {expanded && (
        <div>
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          <div className="mb-3 flex flex-col gap-2">
            {items.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm text-brand-black">
                <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)} />
                {item.label}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={saving}
              className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
            >
              {saving ? 'Submitting…' : 'Submit Checklist'}
            </button>
            <button onClick={() => setExpanded(false)} className="rounded-full border-2 border-brand-grey px-4 py-2 text-xs font-bold uppercase text-brand-body">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CloseBusinessDayCard({ status, onClosed }: { status: TodayStatus; onClosed: () => void }) {
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async () => {
    if (!window.confirm('Close today\'s business day? Once closed, sensitive changes will need manager authorization.')) return;
    setClosing(true);
    setError(null);
    try {
      await api.storeOpsCloseBusinessDay();
      onClosed();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setClosing(false);
    }
  };

  if (status.isBusinessDayClosed) return null;

  return (
    <div className="rounded-2xl border-2 border-brand-black bg-brand-white p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Close Business Day</h2>
      <ul className="mb-4 flex flex-col gap-1 text-sm">
        <li className={status.closingCompleted ? 'text-brand-primary' : 'text-brand-body'}>
          {status.closingCompleted ? '✓' : '○'} Closing checklist submitted
        </li>
        <li className={status.cashShiftClosed ? 'text-brand-primary' : 'text-brand-body'}>
          {status.cashShiftClosed ? '✓' : '○'} Cash shift closed
        </li>
      </ul>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={close}
        disabled={!status.readyToClose || closing}
        className="rounded-full bg-brand-black px-5 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-black/80 disabled:opacity-40"
      >
        {closing ? 'Closing…' : 'Close Business Day'}
      </button>
      {!status.readyToClose && (
        <p className="mt-2 text-xs text-brand-body">Complete the closing checklist and close the cash shift first.</p>
      )}
    </div>
  );
}
