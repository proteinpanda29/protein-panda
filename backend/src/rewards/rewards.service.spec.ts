import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RewardsService } from './rewards.service';

function makeHarness() {
  const prisma: any = {
    reward: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    pointsBalance: { findUnique: jest.fn() },
    rewardRedemption: { create: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  prisma.$transaction = jest.fn().mockImplementation((cb: any) => cb(prisma));
  const points = { award: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new RewardsService(prisma, points);
  return { service, prisma, points };
}

describe('RewardsService.redeem', () => {
  it('rejects when the customer does not have enough points', async () => {
    const { service, prisma } = makeHarness();
    prisma.reward.findUniqueOrThrow.mockResolvedValue({ id: 'reward-1', name: 'Free Shake', pointsCost: 500 });
    prisma.pointsBalance.findUnique.mockResolvedValue({ balance: 100 });

    await expect(service.redeem('cust-1', 'reward-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects when the customer has no points balance record at all', async () => {
    const { service, prisma } = makeHarness();
    prisma.reward.findUniqueOrThrow.mockResolvedValue({ id: 'reward-1', name: 'Free Shake', pointsCost: 500 });
    prisma.pointsBalance.findUnique.mockResolvedValue(null);

    await expect(service.redeem('cust-1', 'reward-1')).rejects.toThrow(/Not enough points/);
  });

  it('deducts the exact points cost and creates the redemption record', async () => {
    const { service, prisma, points } = makeHarness();
    prisma.reward.findUniqueOrThrow.mockResolvedValue({ id: 'reward-1', name: 'Free Shake', pointsCost: 200 });
    prisma.pointsBalance.findUnique.mockResolvedValue({ balance: 500 });
    prisma.rewardRedemption.create.mockResolvedValue({ id: 'redemption-1' });

    await service.redeem('cust-1', 'reward-1');

    expect(points.award).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ customerId: 'cust-1', points: -200, sourceType: 'REDEMPTION' }),
    );
    expect(prisma.rewardRedemption.create).toHaveBeenCalledWith({
      data: { customerId: 'cust-1', rewardId: 'reward-1', pointsSpent: 200 },
      include: { reward: true },
    });
  });
});

describe('RewardsService.assertOwnsRedemption', () => {
  it('rejects when the redemption belongs to a different customer', async () => {
    const { service, prisma } = makeHarness();
    prisma.rewardRedemption.findUniqueOrThrow.mockResolvedValue({ id: 'r1', customerId: 'cust-OTHER' });

    await expect(service.assertOwnsRedemption('cust-1', 'r1')).rejects.toThrow(ForbiddenException);
  });

  it('returns the redemption when ownership is confirmed', async () => {
    const { service, prisma } = makeHarness();
    prisma.rewardRedemption.findUniqueOrThrow.mockResolvedValue({ id: 'r1', customerId: 'cust-1' });

    const result = await service.assertOwnsRedemption('cust-1', 'r1');

    expect(result.id).toBe('r1');
  });
});
