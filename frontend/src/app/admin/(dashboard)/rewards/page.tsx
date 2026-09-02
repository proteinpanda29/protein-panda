'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Reward {
  id: string;
  name: string;
  description: string | null;
  type: string;
  pointsCost: number;
  valueRs: string | null;
  isActive: boolean;
}

const TYPES = ['DISCOUNT', 'FREE_ADDON', 'FREE_ITEM', 'GAME_ATTEMPT', 'SPECIAL'];

export default function AdminRewardsPage() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', type: 'DISCOUNT', pointsCost: '', valueRs: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.adminRewards().then(setRewards).catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const toggleActive = async (r: Reward) => {
    try {
      await api.adminUpdateReward(r.id, { isActive: !r.isActive });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateReward({
        name: form.name,
        description: form.description || undefined,
        type: form.type,
        pointsCost: Number(form.pointsCost),
        valueRs: form.valueRs ? Number(form.valueRs) : undefined,
      });
      setForm({ name: '', description: '', type: 'DISCOUNT', pointsCost: '', valueRs: '' });
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Rewards</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          {showForm ? 'Cancel' : '+ Add Reward'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={submit} className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-brand-grey bg-brand-white p-5 sm:grid-cols-2">
          <input
            required
            placeholder="Reward name (e.g. Free Banana Add-on)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
          />
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          >
            {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <input
            required
            type="number"
            placeholder="Points cost"
            value={form.pointsCost}
            onChange={(e) => setForm({ ...form, pointsCost: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Value in ₹ (optional — e.g. for discounts)"
            value={form.valueRs}
            onChange={(e) => setForm({ ...form, valueRs: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60 sm:col-span-2"
          >
            {saving ? 'Saving…' : 'Save Reward'}
          </button>
        </form>
      )}

      <div className="flex flex-col gap-3">
        {rewards.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-2xl border border-brand-grey bg-brand-white p-4">
            <div>
              <p className="font-bold text-brand-black">{r.name}</p>
              <p className="text-xs text-brand-body">
                {r.type.replace('_', ' ')} · {r.pointsCost} pts{r.valueRs ? ` · ₹${r.valueRs} value` : ''}
              </p>
              {r.description && <p className="text-xs text-brand-body">{r.description}</p>}
            </div>
            <button
              onClick={() => toggleActive(r)}
              className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide ${
                r.isActive ? 'bg-brand-grey/50 text-brand-black' : 'bg-brand-primary text-brand-white'
              }`}
            >
              {r.isActive ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))}
        {rewards.length === 0 && <p className="text-sm text-brand-body">No rewards yet.</p>}
      </div>
    </div>
  );
}
