import { BadRequestException } from '@nestjs/common';
import { BusinessRulesService } from './business-rules.service';

function makeHarness() {
  const prisma: any = {
    businessRuleSettings: {
      upsert: jest.fn().mockResolvedValue({ loyaltyDivisorRs: 10, loyaltyMultiplier: 2, monthlyVisitTarget: 15, requiredChallengesPerMonth: 1 }),
    },
  };
  const service = new BusinessRulesService(prisma);
  return { service, prisma };
}

describe('BusinessRulesService.getRules', () => {
  it('upserts a default row, never throwing if the settings have never been touched', async () => {
    const { service, prisma } = makeHarness();

    const result = await service.getRules();

    expect(prisma.businessRuleSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    expect(result.loyaltyDivisorRs).toBe(10);
  });
});

describe('BusinessRulesService.updateRules', () => {
  it('rejects a zero or negative value for any rule', async () => {
    const { service } = makeHarness();
    await expect(service.updateRules({ monthlyVisitTarget: 0 })).rejects.toThrow(BadRequestException);
    await expect(service.updateRules({ loyaltyMultiplier: -1 })).rejects.toThrow(BadRequestException);
  });

  it('saves a genuinely changed value', async () => {
    const { service, prisma } = makeHarness();

    await service.updateRules({ monthlyVisitTarget: 20 });

    expect(prisma.businessRuleSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      update: { monthlyVisitTarget: 20 },
      create: { id: 'default', monthlyVisitTarget: 20 },
    });
  });
});

describe('BusinessRulesService.calculateLoyaltyPoints', () => {
  it('matches the exact default formula: ₹150 → 30 points', () => {
    const { service } = makeHarness();
    expect(service.calculateLoyaltyPoints(150, { loyaltyDivisorRs: 10, loyaltyMultiplier: 2 })).toBe(30);
  });

  it('produces a genuinely different result once the admin reconfigures the divisor/multiplier', () => {
    const { service } = makeHarness();
    // ₹150 with a ÷5 ×3 formula instead of the default ÷10 ×2
    expect(service.calculateLoyaltyPoints(150, { loyaltyDivisorRs: 5, loyaltyMultiplier: 3 })).toBe(90);
  });

  it('floors partial results the same way the original hardcoded formula always did', () => {
    const { service } = makeHarness();
    // ₹149 → floor(14.9) = 14 → ×2 = 28, not 149/10*2=29.8
    expect(service.calculateLoyaltyPoints(149, { loyaltyDivisorRs: 10, loyaltyMultiplier: 2 })).toBe(28);
  });
});
