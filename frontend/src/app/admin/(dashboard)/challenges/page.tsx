'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ChallengeAttempt {
  id: string;
  challengeCode: string;
  status: string;
  entryFeeRs: string;
  wasFreeAttempt: boolean;
  resultMetric: string;
  didWin: boolean;
  rewardDescription: string | null;
  discountAppliedRs: string | null;
  playedAt: string;
  game: { name: string };
}

interface Dashboard {
  todayTotal: number;
  activeNow: number;
  awaitingVerification: number;
  verified: number;
  wins: number;
  freeAttempts: number;
  totalEntryFeeRevenueRs: number;
  totalDiscountsIssuedRs: number;
  attempts: ChallengeAttempt[];
}

export default function AdminChallengesPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const load = () => {
    api.adminChallengeDashboard().then(setDashboard).catch((err) => setError(err.message));
  };
  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000); // keeps this screen live during a busy shift without a manual refresh
    return () => clearInterval(interval);
  }, []);

  const confirmPayment = async (id: string) => {
    try {
      await api.adminConfirmChallengePayment(id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const verify = async (id: string) => {
    try {
      await api.adminVerifyChallengeAttempt(id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!dashboard) return <p className="text-sm text-brand-body">Loading…</p>;

  const pending = dashboard.attempts.filter((a) => a.status === 'PENDING_PAYMENT');
  const active = dashboard.attempts.filter((a) => a.status === 'IN_PROGRESS');
  const awaiting = dashboard.attempts.filter((a) => a.status === 'AWAITING_VERIFICATION');
  const done = dashboard.attempts.filter((a) => a.status === 'VERIFIED' || a.status === 'CANCELLED');

  return (
    <div>
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Challenge Dashboard</h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Today" value={String(dashboard.todayTotal)} />
        <Stat label="Wins" value={String(dashboard.wins)} />
        <Stat label="Free Attempts" value={String(dashboard.freeAttempts)} />
        <Stat label="Entry Revenue" value={`₹${dashboard.totalEntryFeeRevenueRs}`} />
        <Stat label="Discounts Issued" value={`₹${dashboard.totalDiscountsIssuedRs}`} />
        <Stat label="Active Now" value={String(dashboard.activeNow)} />
        <Stat label="Awaiting Verification" value={String(dashboard.awaitingVerification)} />
        <Stat label="Verified" value={String(dashboard.verified)} />
      </div>

      {pending.length > 0 && (
        <Section title="💳 Waiting on Payment">
          {pending.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white p-4">
              <div>
                <p className="font-bold text-brand-black">#{a.challengeCode} · {a.game.name}</p>
                <p className="text-xs text-brand-body">Entry fee: ₹{a.entryFeeRs}</p>
              </div>
              <button
                onClick={() => confirmPayment(a.id)}
                className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent"
              >
                Confirm Payment
              </button>
            </div>
          ))}
        </Section>
      )}

      {active.length > 0 && (
        <Section title="🏃 In Progress — Record a Result">
          {active.map((a) => (
            <RecordResultCard
              key={a.id}
              attempt={a}
              isRecording={recordingId === a.id}
              onOpen={() => setRecordingId(a.id)}
              onClose={() => setRecordingId(null)}
              onRecorded={() => {
                setRecordingId(null);
                load();
              }}
            />
          ))}
        </Section>
      )}

      {awaiting.length > 0 && (
        <Section title="⏳ Awaiting Verification">
          {awaiting.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white p-4">
              <div>
                <p className="font-bold text-brand-black">#{a.challengeCode} · {a.game.name}</p>
                <p className="text-xs text-brand-body">
                  Result: {a.resultMetric} {a.didWin ? '🏆' : ''} — {a.rewardDescription}
                  {a.discountAppliedRs && Number(a.discountAppliedRs) > 0 ? ` (₹${a.discountAppliedRs} off)` : ''}
                </p>
              </div>
              <button
                onClick={() => verify(a.id)}
                className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent"
              >
                Verify
              </button>
            </div>
          ))}
        </Section>
      )}

      {done.length > 0 && (
        <Section title="✅ Completed Today">
          {done.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl bg-brand-bg px-4 py-3 text-sm">
              <span className="font-semibold text-brand-black">#{a.challengeCode} · {a.game.name}</span>
              <span className="text-brand-body">
                {a.status === 'CANCELLED' ? 'Cancelled' : `${a.resultMetric} ${a.didWin ? '🏆' : ''}`}
              </span>
            </div>
          ))}
        </Section>
      )}

      {dashboard.todayTotal === 0 && <p className="text-sm text-brand-body">No challenges played yet today.</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-brand-grey bg-brand-white p-3 text-center">
      <p className="text-lg font-extrabold text-brand-black">{value}</p>
      <p className="text-[10px] uppercase text-brand-body">{label}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-body">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function RecordResultCard({
  attempt,
  isRecording,
  onOpen,
  onClose,
  onRecorded,
}: {
  attempt: ChallengeAttempt;
  isRecording: boolean;
  onOpen: () => void;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [resultMetric, setResultMetric] = useState('');
  const [purchaseAmountRs, setPurchaseAmountRs] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminRecordChallengeResult(attempt.id, Number(resultMetric), Number(purchaseAmountRs) || 0);
      onRecorded();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isRecording) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white p-4">
        <p className="font-bold text-brand-black">#{attempt.challengeCode} · {attempt.game.name}</p>
        <button
          onClick={onOpen}
          className="rounded-full border-2 border-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-brand-white"
        >
          Record Result
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-brand-primary bg-brand-white p-4">
      <p className="mb-3 font-bold text-brand-black">#{attempt.challengeCode} · {attempt.game.name}</p>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <input
          type="number"
          placeholder="Result (reps / seconds / 1 for pass)"
          value={resultMetric}
          onChange={(e) => setResultMetric(e.target.value)}
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <input
          type="number"
          placeholder="Purchase amount ₹ (for discount cap)"
          value={purchaseAmountRs}
          onChange={(e) => setPurchaseAmountRs(e.target.value)}
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving || !resultMetric}
          className="flex-1 rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save Result'}
        </button>
        <button onClick={onClose} className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black">
          Cancel
        </button>
      </div>
    </div>
  );
}
