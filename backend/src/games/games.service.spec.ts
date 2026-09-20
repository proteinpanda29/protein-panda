import { GamesService } from './games.service';

function makeHarness() {
  const prisma = {
    customer: { findMany: jest.fn() },
    game: { findUnique: jest.fn() },
    gameAttempt: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), create: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    order: { findFirst: jest.fn() },
    $transaction: jest.fn().mockImplementation((fn: any) => fn(prisma)),
  } as any;
  const redis = { zrevrange: jest.fn() } as any;
  const points = { award: jest.fn().mockResolvedValue(undefined) } as any;
  const achievements = { checkGameAchievements: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new GamesService(prisma, redis, points, achievements);
  return { service, prisma, redis };
}

describe('GamesService.getLeaderboard', () => {
  it('returns an empty leaderboard rather than throwing when Redis is unavailable', async () => {
    const { service, redis, prisma } = makeHarness();
    redis.zrevrange.mockRejectedValue(new Error('connect ECONNREFUSED'));
    prisma.customer.findMany.mockResolvedValue([]);

    await expect(service.getLeaderboard()).resolves.toBeDefined();
  });

  it('parses the flat [id, score, id, score, ...] Redis response into entries', async () => {
    const { service, redis, prisma } = makeHarness();
    redis.zrevrange.mockResolvedValue(['cust-1', '500', 'cust-2', '300']);
    prisma.customer.findMany.mockResolvedValue([
      { id: 'cust-1', name: 'Alice' },
      { id: 'cust-2', name: 'Bob' },
    ]);

    const result = await service.getLeaderboard();

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['cust-1', 'cust-2'] } } }),
    );
  });
});

describe('GamesService.getGymLeaderboard', () => {
  it('only queries customers who opted in with a gym name', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findMany.mockResolvedValue([]);

    await service.getGymLeaderboard();

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { gymName: { not: null } } }),
    );
  });

  it('sums points and counts members per gym, ranked highest first', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findMany.mockResolvedValue([
      { gymName: 'Gold Gym', pointsBalance: { balance: 500 } },
      { gymName: 'Gold Gym', pointsBalance: { balance: 300 } },
      { gymName: 'Iron Paradise', pointsBalance: { balance: 1000 } },
    ]);

    const result = await service.getGymLeaderboard();

    expect(result).toEqual([
      { rank: 1, gymName: 'Iron Paradise', totalPoints: 1000, memberCount: 1 },
      { rank: 2, gymName: 'Gold Gym', totalPoints: 800, memberCount: 2 },
    ]);
  });

  it('treats a customer with no points balance yet as contributing zero', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findMany.mockResolvedValue([{ gymName: 'New Gym', pointsBalance: null }]);

    const result = await service.getGymLeaderboard();

    expect(result).toEqual([{ rank: 1, gymName: 'New Gym', totalPoints: 0, memberCount: 1 }]);
  });

  it('returns an empty list when no customer has opted into a gym', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findMany.mockResolvedValue([]);

    await expect(service.getGymLeaderboard()).resolves.toEqual([]);
  });
});

describe('GamesService.createChallengeAttempt — free-attempt eligibility', () => {
  it('charges the real entry fee when there is no ≥₹150 qualifying order', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findUnique.mockResolvedValue({ id: 'g1', isActive: true, entryFeeRs: 49, freeAttemptMinPurchaseRs: 150 });
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.gameAttempt.create.mockImplementation(({ data }: any) => data);

    const result = await service.createChallengeAttempt('cust-1', 'g1');

    expect(result.unlockedFreeAttempt).toBe(false);
    expect(result.entryFeeRs).toBe(49);
    expect(result.status).toBe('PENDING_PAYMENT');
  });

  it('grants a free attempt when a real ≥₹150 order exists and has not been used for this game before', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findUnique.mockResolvedValue({ id: 'g1', isActive: true, entryFeeRs: 49, freeAttemptMinPurchaseRs: 150 });
    prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
    prisma.gameAttempt.create.mockImplementation(({ data }: any) => data);

    const result = await service.createChallengeAttempt('cust-1', 'g1');

    expect(result.unlockedFreeAttempt).toBe(true);
    expect(result.entryFeeRs).toBe(0);
    expect(result.qualifyingOrderId).toBe('order-1');
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('excludes an order already spent on a previous free attempt for the same game', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findUnique.mockResolvedValue({ id: 'g1', isActive: true, entryFeeRs: 49, freeAttemptMinPurchaseRs: 150 });
    prisma.gameAttempt.findMany.mockResolvedValue([{ qualifyingOrderId: 'order-1' }]);
    prisma.order.findFirst.mockResolvedValue(null); // simulating the DB itself excluding order-1

    await service.createChallengeAttempt('cust-1', 'g1');

    const call = prisma.order.findFirst.mock.calls[0][0];
    expect(call.where.id.notIn).toContain('order-1');
  });

  it('a free game (no entry fee, e.g. Coin Balance) skips payment entirely regardless of purchase history', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findUnique.mockResolvedValue({ id: 'g2', isActive: true, entryFeeRs: 0, freeAttemptMinPurchaseRs: null });
    prisma.gameAttempt.create.mockImplementation(({ data }: any) => data);

    const result = await service.createChallengeAttempt('cust-1', 'g2');

    expect(result.status).toBe('IN_PROGRESS');
    expect(result.entryFeeRs).toBe(0);
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a challenge for an inactive or nonexistent game', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findUnique.mockResolvedValue(null);

    await expect(service.createChallengeAttempt('cust-1', 'ghost')).rejects.toThrow(/not found|not.*active/i);
  });
});

describe('GamesService challenge lifecycle guards', () => {
  it('confirmChallengePayment rejects an attempt that is not waiting on payment', async () => {
    const { service, prisma } = makeHarness();
    prisma.gameAttempt.findUniqueOrThrow.mockResolvedValue({ id: 'a1', status: 'IN_PROGRESS' });

    await expect(service.confirmChallengePayment('a1')).rejects.toThrow(/not waiting on payment/i);
  });

  it('recordChallengeResult rejects an attempt that is not in progress', async () => {
    const { service, prisma } = makeHarness();
    prisma.gameAttempt.findUniqueOrThrow.mockResolvedValue({ id: 'a1', status: 'PENDING_PAYMENT', game: {} });

    await expect(service.recordChallengeResult('a1', 100, 0, 'staff-1')).rejects.toThrow(/not currently in progress/i);
  });

  it('verifyChallengeAttempt rejects an attempt with no result awaiting verification', async () => {
    const { service, prisma } = makeHarness();
    prisma.gameAttempt.findUniqueOrThrow.mockResolvedValue({ id: 'a1', status: 'IN_PROGRESS' });

    await expect(service.verifyChallengeAttempt('a1', 'staff-1')).rejects.toThrow(/no recorded result/i);
  });
});
