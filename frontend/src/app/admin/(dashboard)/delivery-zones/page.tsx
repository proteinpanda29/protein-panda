'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Zone {
  id: string;
  name: string;
  maxDistanceKm: string;
  feeRs: string;
  estimatedMinutes: number | null;
  isActive: boolean;
}

export default function DeliveryZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () =>
    api
      .adminListDeliveryZones()
      .then(setZones)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (zone: Zone) => {
    await api.adminUpdateDeliveryZone(zone.id, { isActive: !zone.isActive });
    load();
  };

  const remove = async (zone: Zone) => {
    if (!window.confirm(`Delete the "${zone.name}" zone?`)) return;
    await api.adminDeleteDeliveryZone(zone.id);
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Delivery Zones</h1>
          <p className="text-sm text-brand-body">Real distance-based fees — nearest zone wins. Set your shop&apos;s location on the Settings page first.</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent"
        >
          {showForm ? 'Cancel' : '+ New Zone'}
        </button>
      </div>

      {showForm && <NewZoneForm onCreated={() => { setShowForm(false); load(); }} />}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-brand-body">Loading…</p>}
      {!loading && zones.length === 0 && !error && (
        <p className="text-sm text-brand-body">No zones configured yet — delivery is free until you add one.</p>
      )}

      <div className="flex flex-col gap-2">
        {zones.map((z) => (
          <div key={z.id} className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white p-4">
            <div>
              <p className="text-sm font-bold text-brand-black">
                {z.name} — up to {z.maxDistanceKm} km
              </p>
              <p className="text-xs text-brand-body">
                ₹{z.feeRs}
                {z.estimatedMinutes ? ` · ~${z.estimatedMinutes} min` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleActive(z)}
                className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${
                  z.isActive ? 'bg-brand-primary/20 text-brand-primary' : 'bg-brand-grey text-brand-body'
                }`}
              >
                {z.isActive ? 'Active' : 'Inactive'}
              </button>
              <button onClick={() => remove(z)} className="text-xs font-bold uppercase text-red-600 hover:underline">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewZoneForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [maxDistanceKm, setMaxDistanceKm] = useState('');
  const [feeRs, setFeeRs] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name || !maxDistanceKm || !feeRs) {
      setError('Name, max distance, and fee are all required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateDeliveryZone({
        name,
        maxDistanceKm: Number(maxDistanceKm),
        feeRs: Number(feeRs),
        estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : undefined,
      });
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Zone name (e.g. Nearby)" className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
        <input
          value={maxDistanceKm}
          onChange={(e) => setMaxDistanceKm(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="Max distance (km)"
          inputMode="decimal"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <input
          value={feeRs}
          onChange={(e) => setFeeRs(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="Fee (₹)"
          inputMode="decimal"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <input
          value={estimatedMinutes}
          onChange={(e) => setEstimatedMinutes(e.target.value.replace(/\D/g, ''))}
          placeholder="Est. minutes (optional)"
          inputMode="numeric"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
      </div>
      <button
        onClick={submit}
        disabled={saving}
        className="rounded-full bg-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-black/80 disabled:opacity-60"
      >
        {saving ? 'Creating…' : 'Create Zone'}
      </button>
    </div>
  );
}
