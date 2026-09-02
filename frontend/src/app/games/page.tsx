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
  levels: GameLevel[];
}

interface Attempt {
  id: string;
  resultMetric: string;
  didWin: boolean;
  playedAt: string;
  game: { name: string };
  level: { levelName: string } | null;
}

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loggedIn, setLoggedIn] = useState(true);

  useEffect(() => {
    api.listGames().then(setGames).catch(() => undefined);
    api
      .myGameAttempts()
      .then(setAttempts)
      .catch(() => setLoggedIn(false));
  }, []);

  return (
    <section className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Shop Challenges</h1>
      <p className="mb-8 text-sm text-brand-body">
        Play in-store — staff logs your result and points land instantly. Beat a level to unlock the next one.
      </p>

      <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {games.map((g) => (
          <div key={g.id} className="rounded-2xl border border-brand-grey bg-brand-white p-5">
            <h3 className="mb-1 text-lg font-bold text-brand-black">🎮 {g.name}</h3>
            {g.description && <p className="mb-3 text-sm text-brand-body">{g.description}</p>}
            <div className="flex flex-col gap-1">
              {g.levels
                .sort((a, b) => a.levelNumber - b.levelNumber)
                .map((lvl) => (
                  <div key={lvl.id} className="flex items-center justify-between text-sm">
                    <span className="text-brand-black">
                      L{lvl.levelNumber} · {lvl.levelName}
                    </span>
                    <span className="text-brand-body">🪙 {lvl.pointsAward} pts</span>
                  </div>
                ))}
            </div>
          </div>
        ))}
        {games.length === 0 && <p className="text-sm text-brand-body">No active challenges right now — check back soon.</p>}
      </div>

      <h2 className="mb-4 text-lg font-extrabold uppercase tracking-tight text-brand-black">My Recent Attempts</h2>
      {!loggedIn ? (
        <p className="text-sm text-brand-body">
          <a href="/login" className="font-semibold text-brand-primary underline">Log in</a> to see your game history.
        </p>
      ) : attempts.length === 0 ? (
        <p className="text-sm text-brand-body">No attempts logged yet — ask staff to log your first challenge in-store.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {attempts.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white px-4 py-3 text-sm">
              <span className="font-semibold text-brand-black">
                {a.game.name} {a.level ? `· ${a.level.levelName}` : ''}
              </span>
              <span className="text-brand-body">
                {a.resultMetric} {a.didWin ? '🏆 Win' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
