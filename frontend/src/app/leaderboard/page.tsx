'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { siteConfig } from '@/lib/siteConfig';interface Entry {
  rank: number;
  customerId: string;
  name: string;
  points: number;
}

interface GymEntry {
  rank: number;
  gymName: string;
  totalPoints: number;
  memberCount: number;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardPage() {
  const [tab, setTab] = useState<'individual' | 'gyms'>('individual');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [gymEntries, setGymEntries] = useState<GymEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getLeaderboard().then(setEntries).catch((err) => setError(err.message));
    api.getGymLeaderboard().then(setGymEntries).catch(() => undefined);
  }, []);

  return (
    <section className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-1 text-2xl font-extrabold uppercase tracking-tight text-brand-black">🏆 Champions</h1>
      <p className="mb-6 text-sm text-brand-body">Top {siteConfig.businessName} members by total points this month.</p>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setTab('individual')}
          className={`rounded-full border-2 px-4 py-2 text-xs font-bold uppercase tracking-wide ${
            tab === 'individual' ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
          }`}
        >
          Individual
        </button>
        <button
          onClick={() => setTab('gyms')}
          className={`rounded-full border-2 px-4 py-2 text-xs font-bold uppercase tracking-wide ${
            tab === 'gyms' ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
          }`}
        >
          🏋️ Gym vs Gym
        </button>
      </div>

      {tab === 'individual' ? (
        <>
          {error && <p className="text-sm text-brand-body">Couldn&apos;t load the leaderboard right now.</p>}
          {!error && entries.length === 0 && (
            <p className="rounded-2xl border border-brand-grey bg-brand-white p-6 text-center text-sm text-brand-body">
              No points earned yet this month — be the first on the board!
            </p>
          )}
          <div className="flex flex-col gap-2">
            {entries.map((e) => (
              <div
                key={e.customerId}
                className={`flex items-center justify-between rounded-2xl border p-4 ${
                  e.rank <= 3 ? 'border-brand-accent bg-brand-bg' : 'border-brand-grey bg-brand-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 text-center text-lg font-extrabold text-brand-black">{MEDALS[e.rank - 1] ?? e.rank}</span>
                  <span className="font-semibold text-brand-black">{e.name}</span>
                </div>
                <span className="font-bold text-brand-primary">{e.points.toLocaleString()} pts</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="mb-4 text-xs text-brand-body">
            Only members who added their gym at signup are counted. Add yours from the login screen next time you sign in.
          </p>
          {gymEntries.length === 0 && (
            <p className="rounded-2xl border border-brand-grey bg-brand-white p-6 text-center text-sm text-brand-body">
              No gyms competing yet — be the first to represent your gym!
            </p>
          )}
          <div className="flex flex-col gap-2">
            {gymEntries.map((g) => (
              <div
                key={g.gymName}
                className={`flex items-center justify-between rounded-2xl border p-4 ${
                  g.rank <= 3 ? 'border-brand-accent bg-brand-bg' : 'border-brand-grey bg-brand-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 text-center text-lg font-extrabold text-brand-black">{MEDALS[g.rank - 1] ?? g.rank}</span>
                  <div>
                    <p className="font-semibold text-brand-black">{g.gymName}</p>
                    <p className="text-xs text-brand-body">{g.memberCount} member{g.memberCount > 1 ? 's' : ''}</p>
                  </div>
                </div>
                <span className="font-bold text-brand-primary">{g.totalPoints.toLocaleString()} pts</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
