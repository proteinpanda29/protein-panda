'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discountRs: string | null;
  discountPct: string | null;
  validFrom: string;
  validUntil: string;
  usageLimit: number | null;
  timesUsed: number;
  isActive: boolean;
  minOrderRs: string | null;
  maxUsesPerCustomer: number | null;
  firstOrderOnly: boolean;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [discountType, setDiscountType] = useState<'flat' | 'pct'>('flat');
  const [form, setForm] = useState({
    code: '',
    description: '',
    discountValue: '',
    validFrom: todayISO(),
    validUntil: '',
    usageLimit: '',
    minOrderRs: '',
    maxUsesPerCustomer: '',
    firstOrderOnly: false,
  });
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.adminCoupons().then(setCoupons).catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const toggleActive = async (c: Coupon) => {
    try {
      await api.adminUpdateCoupon(c.id, { isActive: !c.isActive });
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
      await api.adminCreateCoupon({
        code: form.code,
        description: form.description || undefined,
        discountRs: discountType === 'flat' ? Number(form.discountValue) : undefined,
        discountPct: discountType === 'pct' ? Number(form.discountValue) : undefined,
        validFrom: new Date(form.validFrom).toISOString(),
        validUntil: new Date(form.validUntil).toISOString(),
        usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
        minOrderRs: form.minOrderRs ? Number(form.minOrderRs) : undefined,
        maxUsesPerCustomer: form.maxUsesPerCustomer ? Number(form.maxUsesPerCustomer) : undefined,
        firstOrderOnly: form.firstOrderOnly,
      });
      setForm({ code: '', description: '', discountValue: '', validFrom: todayISO(), validUntil: '', usageLimit: '', minOrderRs: '', maxUsesPerCustomer: '', firstOrderOnly: false });
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const isExpired = (c: Coupon) => new Date(c.validUntil) < new Date();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Coupons</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          {showForm ? 'Cancel' : '+ Add Coupon'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={submit} className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-brand-grey bg-brand-white p-5 sm:grid-cols-2">
          <input
            required
            placeholder="Coupon code (e.g. WELCOME10)"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
          />

          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={() => setDiscountType('flat')}
              className={`flex-1 rounded-full border-2 py-2 text-xs font-bold uppercase ${
                discountType === 'flat' ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
              }`}
            >
              Flat ₹ Off
            </button>
            <button
              type="button"
              onClick={() => setDiscountType('pct')}
              className={`flex-1 rounded-full border-2 py-2 text-xs font-bold uppercase ${
                discountType === 'pct' ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
              }`}
            >
              % Off
            </button>
          </div>

          <input
            required
            type="number"
            placeholder={discountType === 'flat' ? 'Discount amount (₹)' : 'Discount percentage'}
            value={form.discountValue}
            onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
          />

          <label className="text-xs font-semibold text-brand-body">
            Valid from
            <input
              required
              type="date"
              value={form.validFrom}
              onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
              className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-brand-body">
            Valid until
            <input
              required
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
              className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
          </label>

          <input
            type="number"
            placeholder="Usage limit (optional — blank = unlimited)"
            value={form.usageLimit}
            onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
          />

          <input
            type="number"
            placeholder="Minimum order ₹ (optional)"
            value={form.minOrderRs}
            onChange={(e) => setForm({ ...form, minOrderRs: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Max uses per customer (optional)"
            value={form.maxUsesPerCustomer}
            onChange={(e) => setForm({ ...form, maxUsesPerCustomer: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-2 text-xs font-semibold text-brand-body sm:col-span-2">
            <input
              type="checkbox"
              checked={form.firstOrderOnly}
              onChange={(e) => setForm({ ...form, firstOrderOnly: e.target.checked })}
            />
            First order only (new customers)
          </label>

          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60 sm:col-span-2"
          >
            {saving ? 'Saving…' : 'Save Coupon'}
          </button>
        </form>
      )}

      <div className="flex flex-col gap-3">
        {coupons.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-2xl border border-brand-grey bg-brand-white p-4">
            <div>
              <p className="font-bold text-brand-black">{c.code}</p>
              <p className="text-xs text-brand-body">
                {c.discountRs ? `₹${c.discountRs} off` : `${c.discountPct}% off`} · Used {c.timesUsed}
                {c.usageLimit ? `/${c.usageLimit}` : ''} times
              </p>
              <p className="text-xs text-brand-body">
                {new Date(c.validFrom).toLocaleDateString()} – {new Date(c.validUntil).toLocaleDateString()}
                {isExpired(c) && <span className="ml-2 text-red-600">Expired</span>}
              </p>
              {(c.minOrderRs || c.maxUsesPerCustomer || c.firstOrderOnly) && (
                <p className="mt-1 flex flex-wrap gap-1">
                  {c.minOrderRs && <span className="rounded-full bg-brand-bg px-2 py-0.5 text-[10px] font-bold uppercase text-brand-body">Min ₹{c.minOrderRs}</span>}
                  {c.maxUsesPerCustomer && <span className="rounded-full bg-brand-bg px-2 py-0.5 text-[10px] font-bold uppercase text-brand-body">Max {c.maxUsesPerCustomer}/customer</span>}
                  {c.firstOrderOnly && <span className="rounded-full bg-brand-bg px-2 py-0.5 text-[10px] font-bold uppercase text-brand-body">First order only</span>}
                </p>
              )}
            </div>
            <button
              onClick={() => toggleActive(c)}
              className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide ${
                c.isActive ? 'bg-brand-grey/50 text-brand-black' : 'bg-brand-primary text-brand-white'
              }`}
            >
              {c.isActive ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))}
        {coupons.length === 0 && <p className="text-sm text-brand-body">No coupons yet.</p>}
      </div>
    </div>
  );
}
