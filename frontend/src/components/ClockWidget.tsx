'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface CurrentShift {
  id: string;
  clockedInAt: string;
}

function useElapsed(since: string) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const totalSeconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function ElapsedDisplay({ since }: { since: string }) {
  const elapsed = useElapsed(since);
  return <>{elapsed}</>;
}

export function ClockWidget() {
  const [current, setCurrent] = useState<CurrentShift | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.staffCurrentShift().then(setCurrent).catch(() => undefined);
  };

  useEffect(load, []);

  const clockIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const shift = await api.staffClockIn();
      setCurrent(shift);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const clockOut = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.staffClockOut();
      setCurrent(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-brand-grey bg-brand-white p-3">
      {current ? (
        <>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-primary">🟢 Clocked In</p>
          <p className="mb-2 text-lg font-extrabold text-brand-black">
            <ElapsedDisplay since={current.clockedInAt} />
          </p>
          <button
            onClick={clockOut}
            disabled={loading}
            className="w-full rounded-full bg-brand-black py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-body disabled:opacity-60"
          >
            {loading ? '...' : 'Clock Out'}
          </button>
        </>
      ) : (
        <>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-body">🔴 Not Clocked In</p>
          <button
            onClick={clockIn}
            disabled={loading}
            className="w-full rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
          >
            {loading ? '...' : 'Clock In'}
          </button>
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
