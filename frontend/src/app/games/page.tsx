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
  rewardDescription: string | null;
  imageUrl: string | null;
  entryFeeRs: string | null;
  freeAttemptMinPurchaseRs: string | null;
  levels: GameLevel[];
}

interface ChallengeAttempt {
  id: string;
  challengeCode: string;
  status: string;
  resultMetric: string;
  didWin: boolean;
  rewardDescription: string | null;
  playedAt: string;
  game: { name: string };
}

interface ChallengeHistory {
  totalPlayed: number;
  totalCompleted: number;
  totalRewardsRs: number;
  attempts: ChallengeAttempt[];
}

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: '💳 Waiting on payment',
  IN_PROGRESS: '🏃 Ready to play',
  AWAITING_VERIFICATION: '⏳ Awaiting staff verification',
  VERIFIED: '✅ Verified',
  CANCELLED: '✕ Cancelled',
};

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [history, setHistory] = useState<ChallengeHistory | null>(null);
  const [loggedIn, setLoggedIn] = useState(true);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [startedAttempt, setStartedAttempt] = useState<ChallengeAttempt | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = () => {
    api
      .myChallengeHistory()
      .then(setHistory)
      .catch(() => setLoggedIn(false));
  };

  useEffect(() => {
    api.listGamesInfo().then(setGames).catch(() => undefined);
    loadHistory();
  }, []);

  const startChallenge = async (game: Game) => {
    setStarting(true);
    setError(null);
    try {
      const attempt = await api.createChallenge(game.id);
      setStartedAttempt(attempt);
      loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">🐼 Challenge Zone</h1>
      <p className="mb-8 text-sm text-brand-body">
        Pick a challenge, confirm the rules, and play in-store — staff verifies your result and your reward is
        applied right there.
      </p>

      <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {games.map((g) => (
          <div key={g.id} className="overflow-hidden rounded-2xl border border-brand-grey bg-brand-white">
            {g.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={g.imageUrl} alt={g.name} className="h-36 w-full object-cover" />
            )}
            <div className="p-5">
              <h3 className="mb-1 text-lg font-bold text-brand-black">🎮 {g.name}</h3>
              {g.description && <p className="mb-3 text-sm text-brand-body">{g.description}</p>}
              <div className="mb-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-brand-bg px-3 py-1 text-xs font-bold text-brand-black">
                  {!g.entryFeeRs || Number(g.entryFeeRs) === 0 ? 'FREE' : `Entry ₹${g.entryFeeRs}`}
                </span>
                {g.freeAttemptMinPurchaseRs && (
                  <span className="rounded-full bg-brand-bg px-3 py-1 text-xs font-bold text-brand-primary">
                    🎉 Free with ₹{g.freeAttemptMinPurchaseRs}+ purchase
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedGame(g)}
                className="w-full rounded-full bg-brand-primary py-2.5 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
              >
                Play Now
              </button>
            </div>
          </div>
        ))}
        {games.length === 0 && <p className="text-sm text-brand-body">No active challenges right now — check back soon.</p>}
      </div>

      <h2 className="mb-4 text-lg font-extrabold uppercase tracking-tight text-brand-black">My Challenges</h2>
      {!loggedIn ? (
        <p className="text-sm text-brand-body">
          <a href="/login" className="font-semibold text-brand-primary underline">Log in</a> to see your challenge history.
        </p>
      ) : history && history.totalPlayed > 0 ? (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-brand-grey bg-brand-white p-3">
              <p className="text-xl font-extrabold text-brand-black">{history.totalPlayed}</p>
              <p className="text-[10px] uppercase text-brand-body">Played</p>
            </div>
            <div className="rounded-xl border border-brand-grey bg-brand-white p-3">
              <p className="text-xl font-extrabold text-brand-black">{history.totalCompleted}</p>
              <p className="text-[10px] uppercase text-brand-body">Completed</p>
            </div>
            <div className="rounded-xl border border-brand-grey bg-brand-white p-3">
              <p className="text-xl font-extrabold text-brand-primary">₹{history.totalRewardsRs}</p>
              <p className="text-[10px] uppercase text-brand-body">Rewards Earned</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {history.attempts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white px-4 py-3 text-sm">
                <div>
                  <p className="font-semibold text-brand-black">{a.game.name} <span className="font-normal text-brand-body">#{a.challengeCode}</span></p>
                  {a.rewardDescription && <p className="text-xs text-brand-primary">{a.rewardDescription}</p>}
                </div>
                <span className="text-xs text-brand-body">{STATUS_LABELS[a.status] ?? a.status}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-brand-body">No challenges played yet — pick one above to get started.</p>
      )}

      {selectedGame && !startedAttempt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedGame(null)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-brand-white p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-bold text-brand-black">{selectedGame.name}</h3>
            {selectedGame.rules && (
              <>
                <p className="mb-1 text-xs font-bold uppercase text-brand-primary">Rules</p>
                <p className="mb-4 whitespace-pre-line text-sm text-brand-black">{selectedGame.rules}</p>
              </>
            )}
            {selectedGame.rewardDescription && (
              <>
                <p className="mb-1 text-xs font-bold uppercase text-brand-primary">Reward</p>
                <p className="mb-4 whitespace-pre-line text-sm text-brand-black">{selectedGame.rewardDescription}</p>
              </>
            )}
            <p className="mb-4 text-sm font-bold text-brand-black">
              {!selectedGame.entryFeeRs || Number(selectedGame.entryFeeRs) === 0
                ? 'This challenge is free to play.'
                : `Entry fee: ₹${selectedGame.entryFeeRs} — pay at the counter (cash, UPI, or card).`}
            </p>
            {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => startChallenge(selectedGame)}
                disabled={starting}
                className="flex-1 rounded-full bg-brand-primary py-3 text-sm font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
              >
                {starting ? 'Starting…' : 'Confirm & Start'}
              </button>
              <button onClick={() => setSelectedGame(null)} className="rounded-full border-2 border-brand-black px-4 py-3 text-sm font-bold uppercase text-brand-black">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {startedAttempt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-brand-white p-6 text-center">
            <p className="mb-2 text-4xl">🎟️</p>
            <h3 className="mb-2 text-lg font-bold text-brand-black">Challenge #{startedAttempt.challengeCode}</h3>
            <p className="mb-4 text-sm text-brand-body">
              {startedAttempt.status === 'PENDING_PAYMENT'
                ? 'Show this code to staff and pay the entry fee to begin.'
                : "You're all set! Show this code to staff to start your challenge."}
            </p>
            <p className="mb-6 rounded-xl bg-brand-bg py-3 text-2xl font-extrabold tracking-widest text-brand-black">
              {startedAttempt.challengeCode}
            </p>
            <button
              onClick={() => {
                setStartedAttempt(null);
                setSelectedGame(null);
              }}
              className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase text-brand-white hover:bg-brand-accent"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
