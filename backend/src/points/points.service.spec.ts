import { PointsSourceType } from '@prisma/client';
import { PointsService } from './points.service';

describe('PointsService.award', () => {
  function makeTx(balanceAfter: { balance: number }) {
    return {
      pointsLedgerEntry: { create: jest.fn().mockResolvedValue({}) },
      pointsBalance: { upsert: jest.fn().mockResolvedValue(balanceAfter) },
    } as any;
  }

  it('writes a ledger entry with the given source and amount', async () => {
    const tx = makeTx({ balance: 120 });
    const redis = { zadd: jest.fn().mockResolvedValue(1) } as any;
    const service = new PointsService({} as any, redis);

    await service.award(tx, { customerId: 'cust-1', points: 20, sourceType: PointsSourceType.GAME_PARTICIPATION });

    expect(tx.pointsLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerId: 'cust-1', points: 20, sourceType: PointsSourceType.GAME_PARTICIPATION }),
    });
  });

  it('upserts the running balance (create for new customers, increment for existing)', async () => {
    const tx = makeTx({ balance: 20 });
    const redis = { zadd: jest.fn().mockResolvedValue(1) } as any;
    const service = new PointsService({} as any, redis);

    await service.award(tx, { customerId: 'cust-1', points: 20, sourceType: PointsSourceType.PURCHASE });

    expect(tx.pointsBalance.upsert).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      create: { customerId: 'cust-1', balance: 20 },
      update: { balance: { increment: 20 } },
    });
  });

  it('accepts negative point values for redemptions', async () => {
    const tx = makeTx({ balance: 80 });
    const redis = { zadd: jest.fn().mockResolvedValue(1) } as any;
    const service = new PointsService({} as any, redis);

    await service.award(tx, { customerId: 'cust-1', points: -100, sourceType: PointsSourceType.REDEMPTION });

    expect(tx.pointsBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { balance: { increment: -100 } } }),
    );
  });

  it('syncs the resulting balance to the Redis leaderboard', async () => {
    const tx = makeTx({ balance: 350 });
    const redis = { zadd: jest.fn().mockResolvedValue(1) } as any;
    const service = new PointsService({} as any, redis);

    await service.award(tx, { customerId: 'cust-1', points: 50, sourceType: PointsSourceType.PURCHASE });

    expect(redis.zadd).toHaveBeenCalledWith('leaderboard:monthly:points', 350, 'cust-1');
  });

  it('does not let a Redis failure reject the award (points already committed to the DB tx)', async () => {
    const tx = makeTx({ balance: 350 });
    const redis = { zadd: jest.fn().mockRejectedValue(new Error('redis down')) } as any;
    const service = new PointsService({} as any, redis);

    await expect(
      service.award(tx, { customerId: 'cust-1', points: 50, sourceType: PointsSourceType.PURCHASE }),
    ).resolves.toBeUndefined();
  });
});

describe('PointsService.getBalance', () => {
  it('returns 0 for a customer with no balance record yet', async () => {
    const prisma = { pointsBalance: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const service = new PointsService(prisma, {} as any);

    await expect(service.getBalance('cust-new')).resolves.toBe(0);
  });

  it('returns the stored balance when one exists', async () => {
    const prisma = { pointsBalance: { findUnique: jest.fn().mockResolvedValue({ balance: 275 }) } } as any;
    const service = new PointsService(prisma, {} as any);

    await expect(service.getBalance('cust-1')).resolves.toBe(275);
  });
});
