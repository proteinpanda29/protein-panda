import { calculateGameReward, FINALIZED_GAME_REWARD_CONFIGS, RewardConfig } from './reward-calculator';

describe('calculateGameReward — Hanging Bar (FREE_PRODUCT_ON_TARGET, 120s)', () => {
  const config = FINALIZED_GAME_REWARD_CONFIGS['Hanging Bar Challenge'];

  it('wins with any one product free at exactly 120 seconds', () => {
    const result = calculateGameReward(config, 120, 0);
    expect(result.didWin).toBe(true);
    expect(result.rewardType).toBe('FREE_PRODUCT');
    expect(result.discountAppliedRs).toBe(0);
  });

  it('does not win one second short', () => {
    const result = calculateGameReward(config, 119, 0);
    expect(result.didWin).toBe(false);
    expect(result.rewardType).toBe('NONE');
  });
});

describe('calculateGameReward — Coin Balance (50% off, max ₹150) — verified against every spec example', () => {
  const config = FINALIZED_GAME_REWARD_CONFIGS['Coin Balance Challenge'];

  it.each([
    [80, 40],
    [100, 50],
    [150, 75],
    [200, 100],
    [250, 125],
    [300, 150], // spec's own "150 MAX" row
    [500, 150], // spec's own "150 MAX" row
  ])('bill of ₹%d discounts exactly ₹%d', (bill, expectedDiscount) => {
    const result = calculateGameReward(config, 1, bill);
    expect(result.didWin).toBe(true);
    expect(result.discountAppliedRs).toBe(expectedDiscount);
  });

  it('gives no discount when the challenge was not completed', () => {
    const result = calculateGameReward(config, 0, 300);
    expect(result.didWin).toBe(false);
    expect(result.discountAppliedRs).toBe(0);
  });
});

describe('calculateGameReward — 100+ Push-Up (PER_UNIT_DISCOUNT) — verified against every spec example', () => {
  const config = FINALIZED_GAME_REWARD_CONFIGS['100+ Clean Push-Up Challenge'];

  it.each([
    [30, 30],
    [40, 40],
    [50, 50],
    [60, 60],
    [75, 75],
    [90, 90],
    [99, 99],
  ])('%d valid reps discounts exactly ₹%d (purchase large enough not to cap it)', (reps, expectedDiscount) => {
    const result = calculateGameReward(config, reps, 1000);
    expect(result.discountAppliedRs).toBe(expectedDiscount);
    expect(result.rewardType).toBe('PER_UNIT_DISCOUNT');
  });

  it('wins a free product at exactly 100 reps, not a discount', () => {
    const result = calculateGameReward(config, 100, 1000);
    expect(result.didWin).toBe(true);
    expect(result.rewardType).toBe('FREE_PRODUCT');
    expect(result.discountAppliedRs).toBe(0);
  });

  it('matches the spec\'s own worked example exactly: 75 push-ups + ₹120 purchase → ₹75 off, pay ₹45', () => {
    const result = calculateGameReward(config, 75, 120);
    expect(result.discountAppliedRs).toBe(75);
    const finalBill = 120 - result.discountAppliedRs;
    expect(finalBill).toBe(45);
  });

  it('caps the discount at the purchase amount when reps would exceed it', () => {
    // 99 reps would normally be ₹99 off, but the purchase is only ₹40.
    const result = calculateGameReward(config, 99, 40);
    expect(result.discountAppliedRs).toBe(40);
    expect(result.rewardDescription).toMatch(/capped at your purchase amount/i);
  });
});

describe('calculateGameReward — Burpee (PER_UNIT_DISCOUNT, target 50) — verified against every spec example', () => {
  const config = FINALIZED_GAME_REWARD_CONFIGS['Burpee Challenge'];

  it.each([
    [20, 20],
    [30, 30],
    [40, 40],
    [45, 45],
    [49, 49],
  ])('%d valid burpees discounts exactly ₹%d', (reps, expectedDiscount) => {
    const result = calculateGameReward(config, reps, 1000);
    expect(result.discountAppliedRs).toBe(expectedDiscount);
  });

  it('wins a free product at exactly 50 burpees', () => {
    const result = calculateGameReward(config, 50, 1000);
    expect(result.didWin).toBe(true);
    expect(result.rewardType).toBe('FREE_PRODUCT');
  });
});

describe('calculateGameReward — 50 Combo Push-Up (PER_UNIT_DISCOUNT, target 50) — verified against every spec example', () => {
  const config = FINALIZED_GAME_REWARD_CONFIGS['50 Combo Push-Up Challenge'];

  it.each([
    [25, 25],
    [30, 30],
    [35, 35],
    [40, 40],
    [45, 45],
    [49, 49],
  ])('%d valid reps discounts exactly ₹%d', (reps, expectedDiscount) => {
    const result = calculateGameReward(config, reps, 1000);
    expect(result.discountAppliedRs).toBe(expectedDiscount);
  });
});

describe('calculateGameReward — Plank (TIERED) — every tier from the spec', () => {
  const config = FINALIZED_GAME_REWARD_CONFIGS['Plank Challenge'];

  it('gives no reward under 3 minutes (180s)', () => {
    const result = calculateGameReward(config, 179, 0);
    expect(result.didWin).toBe(false);
  });

  it('gives the 3-minute tier reward at exactly 180s', () => {
    const result = calculateGameReward(config, 180, 0);
    expect(result.didWin).toBe(true);
    expect(result.rewardDescription).toMatch(/Nutri Plate|egg|tea|coffee|juice|salad/i);
    expect(result.rewardDescription).not.toMatch(/coupon/i);
  });

  it('gives the 4-minute tier reward at exactly 240s, not the 3-minute one', () => {
    const result = calculateGameReward(config, 240, 0);
    expect(result.rewardDescription).toMatch(/₹99/);
  });

  it('gives the 5-minute tier reward PLUS the 10% coupon at exactly 300s', () => {
    const result = calculateGameReward(config, 300, 0);
    expect(result.rewardDescription).toMatch(/₹129/);
    expect(result.rewardDescription).toMatch(/10% discount coupon/i);
  });

  it('a result well past 5 minutes still gets the top tier, not an error', () => {
    const result = calculateGameReward(config, 500, 0);
    expect(result.rewardDescription).toMatch(/₹129/);
  });
});

describe('calculateGameReward — Dizzy Squat (pass/fail free product)', () => {
  const config = FINALIZED_GAME_REWARD_CONFIGS['Dizzy Squat Challenge'];

  it('wins any one free product on successful completion', () => {
    const result = calculateGameReward(config, 1, 0);
    expect(result.didWin).toBe(true);
    expect(result.rewardType).toBe('FREE_PRODUCT');
  });

  it('gives nothing on a failed attempt', () => {
    const result = calculateGameReward(config, 0, 0);
    expect(result.didWin).toBe(false);
  });
});

describe('calculateGameReward — defensive behavior', () => {
  it('never returns a negative discount even with a zero purchase amount', () => {
    const config: RewardConfig = { type: 'PER_UNIT_DISCOUNT', targetMetric: 50, perUnitRs: 1 };
    const result = calculateGameReward(config, 30, 0);
    expect(result.discountAppliedRs).toBe(0);
  });

  it('an unrecognized config type returns NONE rather than throwing', () => {
    const config = { type: 'SOMETHING_UNKNOWN' } as unknown as RewardConfig;
    expect(() => calculateGameReward(config, 10, 10)).not.toThrow();
    expect(calculateGameReward(config, 10, 10).rewardType).toBe('NONE');
  });
});
