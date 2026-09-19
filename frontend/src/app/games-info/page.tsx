'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface GameLevel {
  id: string;
  levelNumber: number;
  levelName: string;
  targetMetric: string;
  pointsAward: number;
}

interface Game {
  id: string;
  name: string;
  description: string | null;
  rules: string | null;
  howToParticipate: string | null;
  rewardDescription: string | null;
  levels: GameLevel[];
}

export default function GamesInfoPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listGamesInfo()
      .then(setGames)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Games & Challenges</h1>
      <p className="mb-6 text-sm text-brand-body">Rules, how to join, and what you win — for every challenge we run in-store.</p>

      {loading && <p className="text-sm text-brand-body">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && games.length === 0 && !error && <p className="text-sm text-brand-body">No games are set up yet.</p>}

      <div className="flex flex-col gap-5">
        {games.map((game, i) => (
          <div key={game.id} className="rounded-2xl border border-brand-grey bg-brand-white p-5">
            <h2 className="mb-1 text-lg font-bold text-brand-black">
              {i + 1}. {game.name}
            </h2>
            {game.description && <p className="mb-3 text-sm text-brand-body">{game.description}</p>}

            {game.rules && (
              <div className="mb-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-brand-primary">📋 Rules</p>
                <p className="whitespace-pre-line text-sm text-brand-black">{game.rules}</p>
              </div>
            )}

            {game.howToParticipate && (
              <div className="mb-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-brand-primary">🙋 How to Participate</p>
                <p className="whitespace-pre-line text-sm text-brand-black">{game.howToParticipate}</p>
              </div>
            )}

            {game.rewardDescription && (
              <div className="mb-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-brand-primary">🏆 Rewards</p>
                <p className="whitespace-pre-line text-sm text-brand-black">{game.rewardDescription}</p>
              </div>
            )}

            {game.levels.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {game.levels.map((lvl) => (
                  <div key={lvl.id} className="rounded-xl bg-brand-bg p-2 text-center">
                    <p className="text-[10px] font-bold uppercase text-brand-body">{lvl.levelName}</p>
                    <p className="text-sm font-bold text-brand-black">{lvl.targetMetric}</p>
                    <p className="text-[10px] text-brand-primary">+{lvl.pointsAward} pts</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
