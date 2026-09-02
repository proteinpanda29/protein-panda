'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AchievementShareCard } from '@/components/AchievementShareCard';

interface XpLevel {
  xp: number;
  level: number;
  name: string;
  icon: string;
  nextLevel: { level: number; name: string; xpNeeded: number } | null;
  progressPct: number;
  xpToNext: number;
}

interface Dashboard {
  goal: string | null;
  dailyProteinGoalG: string | null;
  gymName: string | null;
  today: { proteinG: number; calories: number; carbsG: number; fatG: number; fibreG: number; proteinRemainingG: number | null };
  streak: { current: number; longest: number };
  points: number;
  xpLevel: XpLevel;
  monthlyChallenge: {
    visitsThisMonth: number;
    visitTarget: number;
    visitsComplete: boolean;
    challengesCompletedThisMonth: number;
    challengeTarget: number;
    challengeComplete: boolean;
    rewardEligible: boolean;
  };
}

interface Achievement {
  code: string;
  name: string;
  description: string;
  icon: string;
  pointsReward: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

export default function NutritionPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Achievement | null>(null);

  useEffect(() => {
    api
      .getDashboard()
      .then(setData)
      .catch((err) => setError(err.message));
    api.myAchievements().then(setAchievements).catch(() => undefined);
  }, []);

  if (error) {
    return (
      <section className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-4 text-brand-body">Please log in to see your nutrition dashboard.</p>
        <a
          href="/login"
          className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          Go to Login
        </a>
      </section>
    );
  }

  if (!data) {
    return <p className="px-4 py-16 text-center text-brand-body">Loading your nutrition…</p>;
  }

  const goalG = data.dailyProteinGoalG ? Number(data.dailyProteinGoalG) : 0;
  const progressPct = goalG > 0 ? Math.min((data.today.proteinG / goalG) * 100, 100) : 0;
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">My Nutrition</h1>
        <a href="/report" className="text-xs font-bold uppercase tracking-wide text-brand-primary underline">
          Monthly Report →
        </a>
      </div>

      {/* XP / Level card */}
      <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-black p-6 text-brand-white">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-3xl">{data.xpLevel.icon}</span>
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-grey">Level {data.xpLevel.level}</p>
              <p className="text-lg font-extrabold">{data.xpLevel.name}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-brand-grey">XP</p>
            <p className="text-lg font-extrabold text-brand-accent">{data.xpLevel.xp.toLocaleString()}</p>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-brand-white/20">
          <div className="h-full bg-brand-accent transition-all" style={{ width: `${data.xpLevel.progressPct}%` }} />
        </div>
        {data.xpLevel.nextLevel && (
          <p className="mt-1 text-xs text-brand-grey">
            {data.xpLevel.xpToNext} XP to {data.xpLevel.nextLevel.name}
          </p>
        )}
        {data.gymName && <p className="mt-2 text-xs text-brand-accent">🏋️ Repping {data.gymName}</p>}
      </div>

      <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-6">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-semibold uppercase tracking-wide text-brand-body">Today&apos;s Protein</span>
          <span className="text-sm font-bold text-brand-black">
            {data.today.proteinG}g {goalG ? `/ ${goalG}g` : ''}
          </span>
        </div>
        <div className="h-4 w-full overflow-hidden rounded-full bg-brand-grey">
          <div className="h-full bg-brand-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        {data.today.proteinRemainingG !== null && (
          <p className="mt-2 text-xs text-brand-body">Remaining: {data.today.proteinRemainingG}g</p>
        )}
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Calories Today" value={`${data.today.calories} kcal`} />
        <StatCard label="Carbs Today" value={`${data.today.carbsG}g`} />
        <StatCard label="Fat Today" value={`${data.today.fatG}g`} />
        <StatCard label="Fibre Today" value={`${data.today.fibreG}g`} />
        <StatCard label="🔥 Current Streak" value={`${data.streak.current} days`} />
        <StatCard label="🏆 Longest Streak" value={`${data.streak.longest} days`} />
        <StatCard label="🪙 Points" value={data.points.toLocaleString()} />
        <StatCard label="🎯 Goal" value={data.goal ?? 'Not set'} />
      </div>

      <MonthlyChallengeCard challenge={data.monthlyChallenge} />

      {!data.dailyProteinGoalG && (
        <a
          href="/account"
          className="mb-8 flex items-center justify-between rounded-2xl border-2 border-brand-primary bg-brand-primary/10 px-5 py-4 text-sm font-bold text-brand-black hover:bg-brand-primary/20"
        >
          <span>🎯 You haven&apos;t set a daily protein goal yet — set one to see real progress here.</span>
          <span className="text-brand-primary">Set Goal →</span>
        </a>
      )}

      {achievements.length > 0 && (
        <>
          <h2 className="mb-4 text-lg font-extrabold uppercase tracking-tight text-brand-black">
            Achievements <span className="text-sm font-normal text-brand-body">({unlockedCount}/{achievements.length})</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {achievements.map((a) => (
              <button
                key={a.code}
                onClick={() => a.unlocked && setSharing(a)}
                disabled={!a.unlocked}
                className={`rounded-2xl border p-4 text-center transition-transform ${
                  a.unlocked ? 'border-brand-primary bg-brand-bg hover:scale-105' : 'cursor-default border-brand-grey bg-brand-white opacity-50'
                }`}
                title={a.unlocked ? 'Tap to share' : a.description}
              >
                <p className="mb-1 text-2xl">{a.unlocked ? a.icon : '🔒'}</p>
                <p className="text-xs font-bold text-brand-black">{a.name}</p>
                {a.unlocked && a.pointsReward > 0 && (
                  <p className="text-[10px] text-brand-primary">+{a.pointsReward} pts · tap to share</p>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {sharing && <AchievementShareCard achievement={sharing} onClose={() => setSharing(null)} />}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-brand-grey bg-brand-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-body">{label}</p>
      <p className="mt-1 text-lg font-bold text-brand-black">{value}</p>
    </div>
  );
}

function MonthlyChallengeCard({ challenge }: { challenge: Dashboard['monthlyChallenge'] }) {
  const visitPct = Math.min((challenge.visitsThisMonth / challenge.visitTarget) * 100, 100);

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand-black">🏋️ This Month&apos;s Challenge</h2>
        {challenge.rewardEligible && (
          <span className="rounded-full bg-brand-primary/20 px-2 py-1 text-[10px] font-bold uppercase text-brand-primary">🏆 Reward Eligible!</span>
        )}
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-xs text-brand-body">
          <span>Visits ({challenge.visitsThisMonth}/{challenge.visitTarget})</span>
          {challenge.visitsComplete && <span className="text-brand-primary">✓ Done</span>}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-brand-bg">
          <div className="h-full bg-brand-primary transition-all" style={{ width: `${visitPct}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-brand-body">
        <span>Fitness challenge ({challenge.challengesCompletedThisMonth}/{challenge.challengeTarget})</span>
        {challenge.challengeComplete ? <span className="text-brand-primary">✓ Done</span> : <span>Not yet</span>}
      </div>

      {!challenge.rewardEligible && (
        <p className="mt-3 text-xs text-brand-body">
          Visit {Math.max(challenge.visitTarget - challenge.visitsThisMonth, 0)} more time
          {challenge.visitTarget - challenge.visitsThisMonth === 1 ? '' : 's'} and complete a fitness challenge to unlock this month&apos;s reward.
        </p>
      )}
    </div>
  );
}
