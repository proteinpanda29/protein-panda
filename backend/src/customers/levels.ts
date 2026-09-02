export interface LevelDefinition {
  level: number;
  name: string;
  icon: string;
  minXp: number;
  maxXp: number | null; // null = no upper bound (top level)
}

export const LEVELS: LevelDefinition[] = [
  { level: 1, name: 'Rookie', icon: '🐼', minXp: 0, maxXp: 500 },
  { level: 2, name: 'Starter', icon: '💪', minXp: 500, maxXp: 1500 },
  { level: 3, name: 'Beast', icon: '🔥', minXp: 1500, maxXp: 5000 },
  { level: 4, name: 'Panda Pro', icon: '🏆', minXp: 5000, maxXp: 10000 },
  { level: 5, name: 'Panda Legend', icon: '👑', minXp: 10000, maxXp: null },
];

export function getLevelForXp(xp: number) {
  const current = [...LEVELS].reverse().find((l) => xp >= l.minXp) ?? LEVELS[0];
  const next = LEVELS.find((l) => l.level === current.level + 1) ?? null;
  const progressPct = next ? Math.min(((xp - current.minXp) / (next.minXp - current.minXp)) * 100, 100) : 100;
  const xpToNext = next ? Math.max(next.minXp - xp, 0) : 0;

  return {
    xp,
    level: current.level,
    name: current.name,
    icon: current.icon,
    nextLevel: next ? { level: next.level, name: next.name, xpNeeded: next.minXp } : null,
    progressPct,
    xpToNext,
  };
}
