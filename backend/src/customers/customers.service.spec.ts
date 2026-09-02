import { CustomersService } from './customers.service';

// Shared mock — WalletService is a real dependency now (dashboard
// returns walletBalanceRs), but its actual behavior is covered by
// wallet.service.spec.ts, so a simple stub is all these tests need.
const mockWallet = { getBalance: jest.fn().mockResolvedValue(0), listTransactions: jest.fn().mockResolvedValue([]) } as any;
const mockAttendance = { getMonthlyProgress: jest.fn().mockResolvedValue({ visitsThisMonth: 0, visitTarget: 15, visitsComplete: false, challengesCompletedThisMonth: 0, challengeTarget: 1, challengeComplete: false, rewardEligible: false }) } as any;

function makePrisma(overrides: Partial<any> = {}) {
  const prisma: any = {
    customer: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        goal: 'MUSCLE_STRENGTH',
        dailyProteinGoalG: 140,
        dailyCalorieGoal: 2200,
        gymName: null,
      }),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
    },
    nutritionLog: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { proteinG: 0 } }),
    },
    streak: { findUnique: jest.fn().mockResolvedValue({ currentStreakDays: 5, longestStreakDays: 10 }) },
    pointsBalance: { findUnique: jest.fn().mockResolvedValue({ balance: 300 }) },
    proteinGoalRun: { findFirst: jest.fn().mockResolvedValue(null) },
    pointsLedgerEntry: { aggregate: jest.fn().mockResolvedValue({ _sum: { points: 0 } }) },
    order: { count: jest.fn().mockResolvedValue(0) },
    gameAttempt: { count: jest.fn().mockResolvedValue(0) },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    rewardRedemption: { findMany: jest.fn().mockResolvedValue([]) },
    customerAllergy: { deleteMany: jest.fn().mockResolvedValue({}) },
    membership: { updateMany: jest.fn().mockResolvedValue({}) },
    user: { update: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
  prisma.$transaction = jest.fn().mockImplementation((cb: any) => cb(prisma));
  return prisma;
}

describe('CustomersService.getDashboard — nutrition today summary', () => {
  it('sums all five tracked nutrients, not just protein and calories — carbs/fat/fibre were previously silently dropped even though every NutritionLog row always had them', async () => {
    const prisma = makePrisma({
      nutritionLog: {
        findMany: jest.fn().mockResolvedValue([
          { proteinG: 30, calories: 320, carbsG: 28, fatG: 9, fibreG: 5 },
          { proteinG: 20, calories: 150, carbsG: 10, fatG: 3, fibreG: 2 },
        ]),
      },
    });
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    const result = await service.getDashboard('cust-1');

    expect(result.today).toEqual(
      expect.objectContaining({ proteinG: 50, calories: 470, carbsG: 38, fatG: 12, fibreG: 7 }),
    );
  });

  it('returns zero for every nutrient, not undefined, when nothing has been logged today', async () => {
    const prisma = makePrisma({ nutritionLog: { findMany: jest.fn().mockResolvedValue([]) } });
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    const result = await service.getDashboard('cust-1');

    expect(result.today).toEqual(
      expect.objectContaining({ proteinG: 0, calories: 0, carbsG: 0, fatG: 0, fibreG: 0 }),
    );
  });
});

describe('CustomersService.getDashboard — XP/level', () => {
  it('computes XP from lifetime EARNED points, not the current spendable balance', async () => {
    const prisma = makePrisma();
    prisma.pointsLedgerEntry.aggregate.mockResolvedValue({ _sum: { points: 2000 } });
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    const dashboard = await service.getDashboard('cust-1');

    expect(dashboard.points).toBe(300); // spendable balance shown separately
    expect(dashboard.xpLevel.xp).toBe(2000); // level driven by lifetime earned
    expect(dashboard.xpLevel.level).toBe(3); // Beast (1500-5000)
  });

  it('assigns Rookie for a brand-new customer with zero XP', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    const dashboard = await service.getDashboard('cust-1');

    expect(dashboard.xpLevel.level).toBe(1);
    expect(dashboard.xpLevel.name).toBe('Rookie');
  });
});

describe('CustomersService.getDashboard — monthly 15-visit challenge', () => {
  it('surfaces the real monthly progress from AttendanceService in the dashboard response, not a placeholder', async () => {
    const prisma = makePrisma();
    const attendance = {
      getMonthlyProgress: jest.fn().mockResolvedValue({
        visitsThisMonth: 11,
        visitTarget: 15,
        visitsComplete: false,
        challengesCompletedThisMonth: 1,
        challengeTarget: 1,
        challengeComplete: true,
        rewardEligible: false,
      }),
    } as any;
    const service = new CustomersService(prisma, mockWallet, attendance);

    const dashboard = await service.getDashboard('cust-1');

    expect(dashboard.monthlyChallenge).toEqual({
      visitsThisMonth: 11,
      visitTarget: 15,
      visitsComplete: false,
      challengesCompletedThisMonth: 1,
      challengeTarget: 1,
      challengeComplete: true,
      rewardEligible: false,
    });
    expect(attendance.getMonthlyProgress).toHaveBeenCalledWith(prisma, 'cust-1');
  });
});

describe('CustomersService.updateProfile', () => {
  it('only passes through whitelisted fields, dropping anything else', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    await service.updateProfile('cust-1', {
      name: 'New Name',
      gymName: 'Iron Paradise',
      id: 'attacker-supplied-id',
      referralCode: 'HACKED',
    });

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { name: 'New Name', gymName: 'Iron Paradise' },
    });
  });
});

describe('CustomersService.getMonthlyReport', () => {
  it('picks the highest-quantity product as the favourite', async () => {
    const prisma = makePrisma();
    prisma.orderItem.findMany.mockResolvedValue([
      { productId: 'p1', quantity: 2, product: { name: 'Chocolate Shake' } },
      { productId: 'p2', quantity: 1, product: { name: 'Protein Oats' } },
      { productId: 'p1', quantity: 3, product: { name: 'Chocolate Shake' } },
    ]);
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    const report = await service.getMonthlyReport('cust-1', '2026-08');

    expect(report.favouriteProduct).toBe('Chocolate Shake');
  });

  it('returns null favourite when no orders were placed that month', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    const report = await service.getMonthlyReport('cust-1', '2026-08');

    expect(report.favouriteProduct).toBeNull();
    expect(report.orders).toBe(0);
  });

  it('sums the Rs value of redeemed rewards as money saved', async () => {
    const prisma = makePrisma();
    prisma.rewardRedemption.findMany.mockResolvedValue([
      { reward: { valueRs: 100 } },
      { reward: { valueRs: 50 } },
      { reward: { valueRs: null } },
    ]);
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    const report = await service.getMonthlyReport('cust-1', '2026-08');

    expect(report.moneySavedRs).toBe(150);
  });

  it('defaults to the current month when none is specified', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    const report = await service.getMonthlyReport('cust-1');

    expect(report.month).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('CustomersService.updateProfile', () => {
  it('allows updating marketingOptIn and orderUpdatesOptIn preferences', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    await service.updateProfile('cust-1', { marketingOptIn: true, orderUpdatesOptIn: false });

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { marketingOptIn: true, orderUpdatesOptIn: false },
    });
  });

  it('still strips unlisted fields even alongside preference updates', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    await service.updateProfile('cust-1', { marketingOptIn: true, id: 'hacked', referralCode: 'STEAL' });

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { marketingOptIn: true },
    });
  });
});

describe('CustomersService.deleteMyAccount', () => {
  it('anonymizes the customer profile — clears name, photo, address, gym, goals', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    await service.deleteMyAccount('cust-1', 'user-1');

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: {
        name: 'Deleted User',
        profilePhotoUrl: null,
        address: null,
        gymName: null,
        goal: null,
        dietaryPreference: null,
        dailyProteinGoalG: null,
        dailyCalorieGoal: null,
        marketingOptIn: false,
      },
    });
  });

  it('deletes health-related allergy records entirely, not just anonymizes them', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    await service.deleteMyAccount('cust-1', 'user-1');

    expect(prisma.customerAllergy.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
  });

  it('cancels active memberships so the daily cron never bills a deleted account', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    await service.deleteMyAccount('cust-1', 'user-1');

    expect(prisma.membership.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
  });

  it('clears phone/email and deactivates the account, revoking access immediately', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    await service.deleteMyAccount('cust-1', 'user-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { phone: null, email: null, isActive: false, deletedAt: expect.any(Date) },
    });
  });

  it('does NOT touch Order, Payment, or Refund records — financial history is retained', async () => {
    const prisma = makePrisma();
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    await service.deleteMyAccount('cust-1', 'user-1');

    expect(prisma.order?.update).toBeUndefined();
    expect(prisma.order?.deleteMany).toBeUndefined();
  });
});

describe('CustomersService.exportMyData', () => {
  it('assembles the full customer record with related data for the data export', async () => {
    const prisma = makePrisma();
    prisma.customer.findUniqueOrThrow.mockResolvedValue({ id: 'cust-1', name: 'Test' });
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    await service.exportMyData('cust-1');

    expect(prisma.customer.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-1' },
        include: expect.objectContaining({
          orders: expect.anything(),
          nutritionLogs: true,
          pointsLedger: true,
          allergies: expect.anything(),
        }),
      }),
    );
  });
});

describe('CustomersService.getDashboard — profile fields for account settings', () => {
  it('includes name, dietaryPreference, and notification preferences so the account settings page has what it needs without a second endpoint', async () => {
    const prisma = makePrisma();
    prisma.customer.findUniqueOrThrow.mockResolvedValue({
      name: 'Priya',
      goal: 'MUSCLE_STRENGTH',
      dietaryPreference: 'VEG',
      dailyProteinGoalG: 140,
      dailyCalorieGoal: 2200,
      gymName: 'FitZone',
      address: null,
      marketingOptIn: true,
      orderUpdatesOptIn: false,
    });
    const service = new CustomersService(prisma, mockWallet, mockAttendance);

    const result = await service.getDashboard('cust-1');

    expect(result.name).toBe('Priya');
    expect(result.dietaryPreference).toBe('VEG');
    expect(result.marketingOptIn).toBe(true);
    expect(result.orderUpdatesOptIn).toBe(false);
  });
});
