'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function BusinessRulesPage() {
  const [loyaltyDivisorRs, setLoyaltyDivisorRs] = useState('10');
  const [loyaltyMultiplier, setLoyaltyMultiplier] = useState('2');
  const [monthlyVisitTarget, setMonthlyVisitTarget] = useState('15');
  const [requiredChallengesPerMonth, setRequiredChallengesPerMonth] = useState('1');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .adminGetBusinessRules()
      .then((r) => {
        setLoyaltyDivisorRs(String(r.loyaltyDivisorRs));
        setLoyaltyMultiplier(String(r.loyaltyMultiplier));
        setMonthlyVisitTarget(String(r.monthlyVisitTarget));
        setRequiredChallengesPerMonth(String(r.requiredChallengesPerMonth));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const exampleRs = 150;
  const previewPoints =
    Number(loyaltyDivisorRs) > 0 ? Math.floor(exampleRs / Number(loyaltyDivisorRs)) * Number(loyaltyMultiplier) : 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.adminUpdateBusinessRules({
        loyaltyDivisorRs: Number(loyaltyDivisorRs),
        loyaltyMultiplier: Number(loyaltyMultiplier),
        monthlyVisitTarget: Number(monthlyVisitTarget),
        requiredChallengesPerMonth: Number(requiredChallengesPerMonth),
      });
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-brand-body">Loading…</p>;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Business Rules</h1>
      <p className="mb-6 text-sm text-brand-body">
        Change the loyalty formula and monthly reward targets without touching code. Changes apply immediately, business-wide.
      </p>

      <div className="max-w-lg rounded-2xl border border-brand-grey bg-brand-white p-5">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">🪙 Loyalty Points Formula</h2>
        <p className="mb-3 text-xs text-brand-body">Points = floor(purchase amount ÷ divisor) × multiplier</p>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
            Divisor (₹)
            <input
              value={loyaltyDivisorRs}
              onChange={(e) => setLoyaltyDivisorRs(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
            Multiplier
            <input
              value={loyaltyMultiplier}
              onChange={(e) => setLoyaltyMultiplier(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
            />
          </label>
        </div>
        <p className="mb-6 rounded-lg bg-brand-bg p-3 text-xs text-brand-body">
          Preview: a ₹{exampleRs} purchase currently earns <strong className="text-brand-primary">{previewPoints} points</strong> with these settings.
        </p>

        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">🏋️ Monthly Reward Eligibility</h2>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
            Visits Required
            <input
              value={monthlyVisitTarget}
              onChange={(e) => setMonthlyVisitTarget(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
            Challenges Required
            <input
              value={requiredChallengesPerMonth}
              onChange={(e) => setRequiredChallengesPerMonth(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
            />
          </label>
        </div>
        <p className="mb-6 text-xs text-brand-body">
          A customer becomes reward-eligible after {monthlyVisitTarget} qualifying visits and {requiredChallengesPerMonth} completed fitness challenge{requiredChallengesPerMonth === '1' ? '' : 's'} within a calendar month.
        </p>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {saved && <p className="mb-3 text-sm text-brand-primary">Saved — takes effect immediately.</p>}
        <button
          onClick={save}
          disabled={saving}
          className="rounded-full bg-brand-black px-5 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-black/80 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save Rules'}
        </button>
      </div>
    </div>
  );
}
