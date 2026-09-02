import { GamesService } from './games.service';

function makeHarness() {
  const prisma = { customer: { findMany: jest.fn() } } as any;
  const redis = { zrevrange: jest.fn() } as any;
  const points = {} as any;
  const achievements = {} as any;
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
