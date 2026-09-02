import { AchievementsService } from './achievements.service';

function makeTx(definitions: Record<string, { id: string; code: string; name: string; pointsReward: number }>) {
  const unlockedSet = new Set<string>();
  return {
    achievementDefinition: {
      findUnique: jest.fn().mockImplementation(({ where: { code } }) => Promise.resolve(definitions[code] ?? null)),
    },
    customerAchievement: {
      findUnique: jest.fn().mockImplementation(({ where: { customerId_achievementId } }) => {
        const key = `${customerId_achievementId.customerId}:${customerId_achievementId.achievementId}`;
        return Promise.resolve(unlockedSet.has(key) ? { id: 'existing' } : null);
      }),
      create: jest.fn().mockImplementation(({ data }) => {
        unlockedSet.add(`${data.customerId}:${data.achievementId}`);
        return Promise.resolve({ id: 'new', ...data });
      }),
    },
    order: { count: jest.fn() },
    nutritionLog: { aggregate: jest.fn() },
    gameAttempt: { count: jest.fn() },
    notification: { create: jest.fn().mockResolvedValue({}) },
    __unlockedSet: unlockedSet,
  } as any;
}

const DEFS = {
  FIRST_ORDER: { id: 'a1', code: 'FIRST_ORDER', name: 'First Order', pointsReward: 50 },
  ORDERS_10: { id: 'a2', code: 'ORDERS_10', name: '10 Orders', pointsReward: 100 },
  STREAK_7: { id: 'a3', code: 'STREAK_7', name: '7-Day Streak', pointsReward: 100 },
  PROTEIN_TOTAL_1000: { id: 'a4', code: 'PROTEIN_TOTAL_1000', name: '1000g Club', pointsReward: 200 },
};

describe('AchievementsService.checkOrderAchievements', () => {
  it('unlocks FIRST_ORDER on the first order and awards its points', async () => {
    const tx = makeTx(DEFS);
    tx.order.count.mockResolvedValue(1);
    tx.nutritionLog.aggregate.mockResolvedValue({ _sum: { proteinG: 30 } });
    const points = { award: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new AchievementsService({} as any, points);

    await service.checkOrderAchievements(tx, 'cust-1');

    expect(tx.customerAchievement.create).toHaveBeenCalledWith({
      data: { customerId: 'cust-1', achievementId: 'a1' },
    });
    expect(points.award).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ customerId: 'cust-1', points: 50 }),
    );
  });

  it('creates an in-app notification when an achievement unlocks, inside the same transaction', async () => {
    const tx = makeTx(DEFS);
    tx.order.count.mockResolvedValue(1);
    tx.nutritionLog.aggregate.mockResolvedValue({ _sum: { proteinG: 30 } });
    const points = { award: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new AchievementsService({} as any, points);

    await service.checkOrderAchievements(tx, 'cust-1');

    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerId: 'cust-1', type: 'ACHIEVEMENT', body: 'First Order' }),
    });
  });

  it('does not create a duplicate notification when an achievement is already unlocked (idempotent)', async () => {
    const tx = makeTx(DEFS);
    tx.__unlockedSet.add('cust-1:a1');
    tx.order.count.mockResolvedValue(1);
    tx.nutritionLog.aggregate.mockResolvedValue({ _sum: { proteinG: 30 } });
    const points = { award: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new AchievementsService({} as any, points);

    await service.checkOrderAchievements(tx, 'cust-1');

    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('does not unlock ORDERS_10 before the 10th order', async () => {
    const tx = makeTx(DEFS);
    tx.order.count.mockResolvedValue(5);
    tx.nutritionLog.aggregate.mockResolvedValue({ _sum: { proteinG: 0 } });
    const points = { award: jest.fn() } as any;
    const service = new AchievementsService({} as any, points);

    await service.checkOrderAchievements(tx, 'cust-1');

    const orders10Calls = tx.customerAchievement.create.mock.calls.filter((c: any) => c[0].data.achievementId === 'a2');
    expect(orders10Calls).toHaveLength(0);
  });

  it('unlocks PROTEIN_TOTAL_1000 once lifetime protein crosses the threshold', async () => {
    const tx = makeTx(DEFS);
    tx.order.count.mockResolvedValue(20);
    tx.nutritionLog.aggregate.mockResolvedValue({ _sum: { proteinG: 1200 } });
    const points = { award: jest.fn() } as any;
    const service = new AchievementsService({} as any, points);

    await service.checkOrderAchievements(tx, 'cust-1');

    expect(tx.customerAchievement.create).toHaveBeenCalledWith({
      data: { customerId: 'cust-1', achievementId: 'a4' },
    });
  });

  it('is idempotent — calling twice never unlocks or awards points twice', async () => {
    const tx = makeTx(DEFS);
    tx.order.count.mockResolvedValue(1);
    tx.nutritionLog.aggregate.mockResolvedValue({ _sum: { proteinG: 0 } });
    const points = { award: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new AchievementsService({} as any, points);

    await service.checkOrderAchievements(tx, 'cust-1');
    await service.checkOrderAchievements(tx, 'cust-1');

    const firstOrderCreateCalls = tx.customerAchievement.create.mock.calls.filter(
      (c: any) => c[0].data.achievementId === 'a1',
    );
    expect(firstOrderCreateCalls).toHaveLength(1);
    expect(points.award).toHaveBeenCalledTimes(1);
  });

  it('silently skips an achievement code that has not been seeded', async () => {
    const tx = makeTx({}); // no definitions at all
    tx.order.count.mockResolvedValue(1);
    tx.nutritionLog.aggregate.mockResolvedValue({ _sum: { proteinG: 0 } });
    const points = { award: jest.fn() } as any;
    const service = new AchievementsService({} as any, points);

    await expect(service.checkOrderAchievements(tx, 'cust-1')).resolves.toBeUndefined();
    expect(points.award).not.toHaveBeenCalled();
  });
});

describe('AchievementsService.checkStreakAchievements', () => {
  it('unlocks STREAK_7 at exactly 7 days but not before', async () => {
    const tx = makeTx(DEFS);
    const points = { award: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new AchievementsService({} as any, points);

    await service.checkStreakAchievements(tx, 'cust-1', 6);
    expect(tx.customerAchievement.create).not.toHaveBeenCalled();

    await service.checkStreakAchievements(tx, 'cust-1', 7);
    expect(tx.customerAchievement.create).toHaveBeenCalledWith({ data: { customerId: 'cust-1', achievementId: 'a3' } });
  });
});
