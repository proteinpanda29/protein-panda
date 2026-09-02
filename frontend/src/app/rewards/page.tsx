'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Reward {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  type: string;
}

interface Redemption {
  id: string;
  pointsSpent: number;
  redeemedAt: string;
  usedAt: string | null;
  reward: { name: string };
}

const REWARD_ICONS: Record<string, string> = {
  DISCOUNT: '💸',
  FREE_ADDON: '🥜',
  FREE_ITEM: '🥤',
  GAME_ATTEMPT: '🎮',
  SPECIAL: '🎁',
};

export default function RewardsPage() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [points, setPoints] = useState<number | null>(null);
  const [loggedIn, setLoggedIn] = useState(true);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    api.listRewards().then(setRewards).catch(() => undefined);
    Promise.all([api.getDashboard(), api.myRedemptions()])
      .then(([dash, reds]) => {
        setPoints(dash.points);
        setRedemptions(reds);
      })
      .catch(() => setLoggedIn(false));
  };

  useEffect(load, []);

  const redeem = async (reward: Reward) => {
    setRedeeming(reward.id);
    setMessage(null);
    try {
      await api.redeemReward(reward.id);
      setMessage(`🎉 Redeemed ${reward.name}! Show this at the counter.`);
      load();
    } catch (err: any) {
      setMessage(err.message ?? 'Could not redeem this reward');
    } finally {
      setRedeeming(null);
    }
  };

  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Your Rewards</h1>
        {loggedIn && points !== null && (
          <span className="rounded-full bg-brand-black px-4 py-2 text-sm font-bold text-brand-white">🪙 {points.toLocaleString()} points</span>
        )}
      </div>

      {!loggedIn && (
        <p className="mb-8 text-sm text-brand-body">
          <a href="/login" className="font-semibold text-brand-primary underline">Log in</a> to see your points and redeem rewards.
        </p>
      )}

      {message && <p className="mb-6 rounded-xl bg-brand-bg p-3 text-sm text-brand-black">{message}</p>}

      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {rewards.map((r) => {
          const affordable = points !== null && points >= r.pointsCost;
          return (
            <div key={r.id} className="flex flex-col justify-between rounded-2xl border border-brand-grey bg-brand-white p-5">
              <div>
                <p className="mb-1 text-lg font-bold text-brand-black">
                  {REWARD_ICONS[r.type] ?? '🎁'} {r.name}
                </p>
                {r.description && <p className="mb-3 text-sm text-brand-body">{r.description}</p>}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-brand-black">{r.pointsCost.toLocaleString()} pts</span>
                <button
                  onClick={() => redeem(r)}
                  disabled={!loggedIn || !affordable || redeeming === r.id}
                  className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-40"
                >
                  {redeeming === r.id ? 'Redeeming…' : 'Redeem'}
                </button>
              </div>
            </div>
          );
        })}
        {rewards.length === 0 && <p className="text-sm text-brand-body">No rewards available right now.</p>}
      </div>

      {loggedIn && redemptions.length > 0 && (
        <>
          <h2 className="mb-4 text-lg font-extrabold uppercase tracking-tight text-brand-black">Redemption History</h2>
          <div className="flex flex-col gap-2">
            {redemptions.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white px-4 py-3 text-sm">
                <span className="font-semibold text-brand-black">{r.reward.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-brand-body">
                    −{r.pointsSpent} pts · {r.usedAt ? 'Used' : 'Available to collect'}
                  </span>
                  <button
                    onClick={() => api.downloadRedemptionReceipt(r.id)}
                    className="rounded-full border-2 border-brand-black px-3 py-1 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary"
                  >
                    📄 Voucher
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
