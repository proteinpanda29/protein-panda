'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

interface Report {
  month: string;
  orders: number;
  proteinConsumedG: number;
  currentStreak: number;
  gamesPlayed: number;
  xpEarned: number;
  favouriteProduct: string | null;
  moneySavedRs: number;
}

function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function currentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MonthlyReportPage() {
  const [month, setMonth] = useState(currentMonthStr());
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .getMonthlyReport(month)
      .then(setReport)
      .catch((err) => setError(err.message));
  }, [month]);

  const downloadCard = async () => {
    if (!cardRef.current) return;
    setBusy(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(cardRef.current, { backgroundColor: null, scale: 2 });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `protein-panda-report-${month}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <section className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-4 text-sm text-brand-body">Please log in to see your monthly report. ({error})</p>
        <a href="/login" className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent">
          Go to Login
        </a>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md px-4 py-12">
      <div className="mb-6 flex items-center justify-between">
        <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="text-brand-body hover:text-brand-black">← Prev</button>
        <h1 className="text-lg font-extrabold uppercase tracking-tight text-brand-black">{monthLabel(month)}</h1>
        <button
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          disabled={month >= currentMonthStr()}
          className="text-brand-body hover:text-brand-black disabled:opacity-30"
        >
          Next →
        </button>
      </div>

      {!report ? (
        <p className="text-center text-sm text-brand-body">Loading…</p>
      ) : (
        <>
          <div ref={cardRef} className="mb-6 rounded-3xl border-4 border-brand-primary bg-gradient-to-b from-brand-black to-brand-charcoal p-8 text-brand-white">
            <p className="mb-1 text-center text-xs font-bold uppercase tracking-widest text-brand-accent">🐼 Your Panda Report</p>
            <p className="mb-6 text-center text-lg font-extrabold">{monthLabel(report.month)}</p>

            <div className="grid grid-cols-2 gap-4 text-center">
              <ReportStat label="Orders" value={report.orders} />
              <ReportStat label="Protein" value={`${report.proteinConsumedG}g`} />
              <ReportStat label="Streak" value={`${report.currentStreak}d 🔥`} />
              <ReportStat label="Games" value={report.gamesPlayed} />
              <ReportStat label="XP Earned" value={report.xpEarned.toLocaleString()} />
              <ReportStat label="Saved" value={`₹${report.moneySavedRs}`} />
            </div>

            {report.favouriteProduct && (
              <p className="mt-6 text-center text-sm text-brand-grey">
                Favourite: <span className="font-bold text-brand-white">{report.favouriteProduct}</span>
              </p>
            )}

            <p className="mt-6 text-center text-lg font-extrabold tracking-tight">
              PROTEIN <span className="text-brand-accent">PANDA</span>
            </p>
          </div>

          <button
            onClick={downloadCard}
            disabled={busy}
            className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
          >
            {busy ? 'Preparing…' : '⬇ Download & Share'}
          </button>
        </>
      )}
    </section>
  );
}

function ReportStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-2xl font-extrabold text-brand-accent">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-brand-grey">{label}</p>
    </div>
  );
}
