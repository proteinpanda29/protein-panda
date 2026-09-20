/**
 * The reward/discount logic for all 7 challenge games, driven entirely
 * by each Game's own rewardConfig JSON rather than hard-coded per-game
 * branches. This keeps two things the finalized spec explicitly left
 * open — Coin Balance's exact mechanics and the Combo Push-Up's exact
 * exercise sequence — genuinely admin-editable without a code change,
 * while still encoding every other game's exact, finalized numbers.
 *
 * Kept as a pure function (no database, no side effects) so every
 * numeric example in the spec can be verified directly in a unit test.
 */

export interface RewardTier {
  minMetric: number;
  rewardDescription: string;
  /** An extra flat-percent coupon on top of the tier's own reward — used by Plank's 5-minute tier (10% dine-in coupon). */
  extraCouponPct?: number;
}

export interface RewardConfig {
  type: 'FREE_PRODUCT_ON_TARGET' | 'PERCENT_DISCOUNT_ON_COMPLETION' | 'PER_UNIT_DISCOUNT' | 'TIERED';
  /** The value resultMetric must reach or exceed to win. Ignored for TIERED (each tier has its own). */
  targetMetric?: number;
  /** e.g. 129 for "any product below ₹129" — purely descriptive, the actual product-price enforcement happens at redemption time in the POS/checkout flow. */
  maxProductPriceRs?: number | null;
  percentOff?: number;
  maxDiscountRs?: number;
  /** Rupees off per unit of resultMetric below target — e.g. ₹1 per valid rep. */
  perUnitRs?: number;
  tiers?: RewardTier[];
}

export interface RewardResult {
  didWin: boolean;
  rewardType: 'FREE_PRODUCT' | 'PERCENT_DISCOUNT' | 'PER_UNIT_DISCOUNT' | 'TIERED' | 'NONE';
  rewardDescription: string;
  discountAppliedRs: number;
}

const NO_REWARD: Omit<RewardResult, 'rewardDescription'> = { didWin: false, rewardType: 'NONE', discountAppliedRs: 0 };

/**
 * @param purchaseAmountRs the customer's eligible food/product purchase for this visit — discounts are
 *   always capped against this, per the finalized spec's "discount cannot exceed the eligible purchase
 *   amount" rule, so a genuinely excessive result never produces a negative bill.
 */
export function calculateGameReward(config: RewardConfig, resultMetric: number, purchaseAmountRs: number): RewardResult {
  switch (config.type) {
    case 'FREE_PRODUCT_ON_TARGET': {
      const target = config.targetMetric ?? 0;
      if (resultMetric >= target) {
        return {
          didWin: true,
          rewardType: 'FREE_PRODUCT',
          rewardDescription: config.maxProductPriceRs
            ? `Any one product ₹${config.maxProductPriceRs} or below — FREE`
            : 'Any one menu product — FREE',
          discountAppliedRs: 0,
        };
      }
      return { ...NO_REWARD, rewardDescription: 'Target not reached — no reward this attempt' };
    }

    case 'PERCENT_DISCOUNT_ON_COMPLETION': {
      // A pass/fail challenge (e.g. Coin Balance) is represented as
      // resultMetric = 1 for a successful attempt, 0 otherwise —
      // targetMetric defaults to 1 so a plain "did they complete it"
      // check needs no special-casing here.
      const target = config.targetMetric ?? 1;
      if (resultMetric < target) {
        return { ...NO_REWARD, rewardDescription: 'Challenge not completed — no reward' };
      }
      const pct = config.percentOff ?? 0;
      const rawDiscount = (purchaseAmountRs * pct) / 100;
      const cappedDiscount = config.maxDiscountRs !== undefined ? Math.min(rawDiscount, config.maxDiscountRs) : rawDiscount;
      const finalDiscount = Math.round(cappedDiscount * 100) / 100;
      return {
        didWin: true,
        rewardType: 'PERCENT_DISCOUNT',
        rewardDescription:
          finalDiscount < rawDiscount
            ? `${pct}% off — capped at the ₹${config.maxDiscountRs} maximum`
            : `${pct}% off this purchase`,
        discountAppliedRs: finalDiscount,
      };
    }

    case 'PER_UNIT_DISCOUNT': {
      const target = config.targetMetric ?? 0;
      if (resultMetric >= target) {
        return {
          didWin: true,
          rewardType: 'FREE_PRODUCT',
          rewardDescription: config.maxProductPriceRs
            ? `Any one product below ₹${config.maxProductPriceRs} — FREE`
            : 'Any one menu product — FREE',
          discountAppliedRs: 0,
        };
      }
      const perUnit = config.perUnitRs ?? 1;
      const rawDiscount = resultMetric * perUnit;
      // Never exceeds the customer's own eligible purchase — the
      // finalized spec's explicit rule, and what actually prevents an
      // exceptional result from producing a negative bill.
      const cappedDiscount = Math.min(rawDiscount, Math.max(purchaseAmountRs, 0));
      const finalDiscount = Math.round(cappedDiscount * 100) / 100;
      return {
        didWin: false, // reaching the discount tier, not the free-product tier, is not "winning" outright
        rewardType: 'PER_UNIT_DISCOUNT',
        rewardDescription:
          finalDiscount < rawDiscount
            ? `₹${finalDiscount} off (${resultMetric} valid reps × ₹${perUnit}, capped at your purchase amount)`
            : `₹${finalDiscount} off (${resultMetric} valid reps × ₹${perUnit})`,
        discountAppliedRs: finalDiscount,
      };
    }

    case 'TIERED': {
      // Highest-qualifying tier wins — a 5-minute plank clears the
      // 3-minute tier's threshold too, and should get the 5-minute
      // reward, not the first (lowest) one it technically exceeds.
      const tiers = [...(config.tiers ?? [])].sort((a, b) => b.minMetric - a.minMetric);
      const matched = tiers.find((t) => resultMetric >= t.minMetric);
      if (!matched) {
        return { ...NO_REWARD, rewardDescription: 'No tier reached — no reward this attempt' };
      }
      const description = matched.extraCouponPct
        ? `${matched.rewardDescription} + ${matched.extraCouponPct}% discount coupon`
        : matched.rewardDescription;
      return { didWin: true, rewardType: 'TIERED', rewardDescription: description, discountAppliedRs: 0 };
    }

    default:
      return { ...NO_REWARD, rewardDescription: 'No reward configured for this game' };
  }
}

/**
 * The finalized, exact configuration for all 7 games — used to seed
 * new Game rows and as the reference the admin panel's editable
 * rewardConfig starts from. Coin Balance's config here is a
 * placeholder pending the admin finalizing its real mechanics (see
 * the schema comment on Game.rewardConfig); everything else matches
 * the spec's own numbers exactly.
 */
export const FINALIZED_GAME_REWARD_CONFIGS: Record<string, RewardConfig> = {
  'Hanging Bar Challenge': { type: 'FREE_PRODUCT_ON_TARGET', targetMetric: 120 }, // 2 minutes, in seconds
  'Dizzy Squat Challenge': { type: 'FREE_PRODUCT_ON_TARGET', targetMetric: 1 }, // pass/fail: 15 rounds + 5 squats done correctly
  'Coin Balance Challenge': { type: 'PERCENT_DISCOUNT_ON_COMPLETION', targetMetric: 1, percentOff: 50, maxDiscountRs: 150 },
  'Plank Challenge': {
    type: 'TIERED',
    tiers: [
      { minMetric: 180, rewardDescription: 'Choice of Nutri Plate 3 Set (Combo 1), any egg variety, any tea/coffee, any fresh juice, fruit salad, or vegetable salad' },
      { minMetric: 240, rewardDescription: 'Any one product ₹99 or below — FREE' },
      { minMetric: 300, rewardDescription: 'Any one product ₹129 or below — FREE', extraCouponPct: 10 },
    ],
  },
  '100+ Clean Push-Up Challenge': { type: 'PER_UNIT_DISCOUNT', targetMetric: 100, perUnitRs: 1, maxProductPriceRs: 129 },
  'Burpee Challenge': { type: 'PER_UNIT_DISCOUNT', targetMetric: 50, perUnitRs: 1, maxProductPriceRs: 129 },
  '50 Combo Push-Up Challenge': { type: 'PER_UNIT_DISCOUNT', targetMetric: 50, perUnitRs: 1, maxProductPriceRs: 129 },
};
