'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ChecklistItem {
  id: string;
  label: string;
  category: string;
  requiresTemperature: boolean;
  minTempC: string | null;
  maxTempC: string | null;
}

interface LogEntry {
  id: string;
  isCompleted: boolean;
  temperatureC: string | null;
  isOutOfRange: boolean;
  note: string | null;
  checklistItem: { label: string; category: string };
}

interface Log {
  id: string;
  logDate: string;
  shiftLabel: string | null;
  submittedByUser: { staff: { name: string } | null } | null;
  entries: LogEntry[];
}

const CATEGORY_LABELS: Record<string, string> = {
  OPENING: 'Opening',
  CLOSING: 'Closing',
  CLEANING: 'Cleaning',
  SANITIZATION: 'Sanitization',
  HYGIENE: 'Staff Hygiene',
  TEMPERATURE: 'Temperature Checks',
  OTHER: 'Other Checks',
};
const CATEGORY_ORDER = ['OPENING', 'TEMPERATURE', 'OTHER', 'CLEANING', 'SANITIZATION', 'HYGIENE', 'CLOSING'];

export default function AdminFoodSafetyPage() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shiftLabel, setShiftLabel] = useState('Opening');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [temps, setTemps] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const load = () => {
    api.adminFoodSafetyItems().then(setItems).catch((err) => setError(err.message));
    api.adminFoodSafetyLogs().then(setLogs).catch(() => undefined);
  };

  useEffect(load, []);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      const entries = items.map((item) => ({
        checklistItemId: item.id,
        isCompleted: checked[item.id] ?? false,
        temperatureC: item.requiresTemperature && temps[item.id] ? Number(temps[item.id]) : undefined,
        note: notes[item.id] || undefined,
      }));
      await api.adminSubmitFoodSafetyLog({ shiftLabel, entries });
      setSuccess(true);
      setChecked({});
      setTemps({});
      setNotes({});
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const grouped = CATEGORY_ORDER.map((cat) => ({ category: cat, items: items.filter((i) => i.category === cat) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Food Safety</h1>
      <p className="mb-6 text-sm text-brand-body">Internal daily compliance log — never shown to customers. Kept as your audit trail.</p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {success && <p className="mb-4 text-sm text-brand-primary">Checklist submitted.</p>}

      <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
        <label className="mb-4 block text-xs font-semibold uppercase tracking-wide text-brand-body">
          Shift
          <select value={shiftLabel} onChange={(e) => setShiftLabel(e.target.value)} className="mt-1 w-full max-w-xs rounded-lg border border-brand-grey px-3 py-2 text-sm normal-case">
            <option>Opening</option>
            <option>Midday</option>
            <option>Closing</option>
          </select>
        </label>

        {grouped.map((group) => (
          <div key={group.category} className="mb-5">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-accent">{CATEGORY_LABELS[group.category]}</p>
            <div className="flex flex-col gap-2">
              {group.items.map((item) => (
                <div key={item.id} className="rounded-lg bg-brand-bg p-3">
                  {item.requiresTemperature ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 text-sm text-brand-black">
                        {item.label} {item.minTempC && item.maxTempC && <span className="text-xs text-brand-body">(safe: {item.minTempC}°C – {item.maxTempC}°C)</span>}
                      </span>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="°C"
                        value={temps[item.id] ?? ''}
                        onChange={(e) => setTemps((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        className={`w-24 rounded-lg border px-3 py-2 text-sm ${
                          temps[item.id] && item.minTempC && item.maxTempC && (Number(temps[item.id]) < Number(item.minTempC) || Number(temps[item.id]) > Number(item.maxTempC))
                            ? 'border-red-500 bg-red-50'
                            : 'border-brand-grey'
                        }`}
                      />
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 text-sm text-brand-black">
                      <input
                        type="checkbox"
                        checked={checked[item.id] ?? false}
                        onChange={(e) => setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                      />
                      {item.label}
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <button
          onClick={submit}
          disabled={submitting || items.length === 0}
          className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : `Submit ${shiftLabel} Checklist`}
        </button>
      </div>

      <h2 className="mb-3 text-lg font-extrabold uppercase tracking-tight text-brand-black">History</h2>
      <div className="flex flex-col gap-3">
        {logs.map((log) => {
          const flagged = log.entries.filter((e) => e.isOutOfRange);
          return (
            <div key={log.id} className={`rounded-2xl border p-4 ${flagged.length > 0 ? 'border-red-300 bg-red-50' : 'border-brand-grey bg-brand-white'}`}>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-bold text-brand-black">
                  {log.shiftLabel ?? 'Checklist'} · {new Date(log.logDate).toLocaleString()}
                </p>
                {flagged.length > 0 && <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">⚠️ {flagged.length} out of range</span>}
              </div>
              <p className="mb-2 text-xs text-brand-body">By {log.submittedByUser?.staff?.name ?? 'Staff'}</p>
              <ul className="flex flex-col gap-1 text-xs text-brand-body">
                {log.entries.map((e) => (
                  <li key={e.id} className={e.isOutOfRange ? 'font-bold text-red-700' : ''}>
                    {e.checklistItem.label}: {e.temperatureC !== null ? `${e.temperatureC}°C` : e.isCompleted ? '✓' : '✗'}
                    {e.isOutOfRange && ' — OUT OF RANGE'}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {logs.length === 0 && <p className="text-sm text-brand-body">No checklists submitted yet.</p>}
      </div>
    </div>
  );
}
