import { getLevelForXp } from './levels';

describe('getLevelForXp', () => {
  it('starts everyone at Rookie (level 1) with 0 XP', () => {
    const result = getLevelForXp(0);
    expect(result.level).toBe(1);
    expect(result.name).toBe('Rookie');
  });

  it('is still Rookie one XP below the Starter threshold', () => {
    expect(getLevelForXp(499).level).toBe(1);
  });

  it('becomes Starter exactly at the threshold', () => {
    const result = getLevelForXp(500);
    expect(result.level).toBe(2);
    expect(result.name).toBe('Starter');
  });

  it('reaches the top level (Panda Legend) at 10,000 XP with no upper bound', () => {
    const result = getLevelForXp(10_000);
    expect(result.level).toBe(5);
    expect(result.name).toBe('Panda Legend');
    expect(result.nextLevel).toBeNull();
    expect(result.progressPct).toBe(100);
  });

  it('reports correct progress toward the next level', () => {
    // Beast is 1500-5000; at 3250 that's exactly halfway
    const result = getLevelForXp(3250);
    expect(result.level).toBe(3);
    expect(result.progressPct).toBeCloseTo(50, 5);
    expect(result.xpToNext).toBe(1750);
  });

  it('handles arbitrarily large XP without erroring', () => {
    expect(() => getLevelForXp(1_000_000)).not.toThrow();
    expect(getLevelForXp(1_000_000).level).toBe(5);
  });
});
