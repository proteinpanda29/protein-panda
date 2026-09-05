import { AttendanceService } from './attendance.service';

const DEFAULT_RULES = { monthlyVisitTarget: 15, requiredChallengesPerMonth: 1 };

function makeHarness(ruleOverrides: Partial<typeof DEFAULT_RULES> = {}) {
  const prisma: any = {
    attendance: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
    gameAttempt: { count: jest.fn().mockResolvedValue(0) },
  };
  const businessRules = { getRules: jest.fn().mockResolvedValue({ ...DEFAULT_RULES, ...ruleOverrides }) } as any;
  const service = new AttendanceService(businessRules);
  return { service, prisma, businessRules };
}

describe('AttendanceService.recordVisit', () => {
  it('creates a real attendance row for a genuinely new visit today', async () => {
    const { service, prisma } = makeHarness();

    await service.recordVisit(prisma, 'cust-1', 'order-1');

    expect(prisma.attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: 'cust-1', orderId: 'order-1', verificationMethod: 'POS_PURCHASE' }) }),
    );
  });

  it('is idempotent — a second qualifying order the same day does not create a duplicate visit', async () => {
    const { service, prisma } = makeHarness();
    prisma.attendance.findUnique.mockResolvedValue({ id: 'existing-visit' });

    const result = await service.recordVisit(prisma, 'cust-1', 'order-2');

    expect(prisma.attendance.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'existing-visit' });
  });
});

describe('AttendanceService.getMonthlyProgress', () => {
  it('reports the real, currently-configured target values — the system defaults out of the box', async () => {
    const { service, prisma } = makeHarness();

    const result = await service.getMonthlyProgress(prisma, 'cust-1');

    expect(result.visitTarget).toBe(15);
    expect(result.challengeTarget).toBe(1);
  });

  it('uses a genuinely different target once the admin has reconfigured it — not the old hardcoded 15', async () => {
    const { service, prisma } = makeHarness({ monthlyVisitTarget: 20, requiredChallengesPerMonth: 2 });
    prisma.attendance.count.mockResolvedValue(15);

    const result = await service.getMonthlyProgress(prisma, 'cust-1');

    expect(result.visitTarget).toBe(20);
    expect(result.challengeTarget).toBe(2);
    expect(result.visitsComplete).toBe(false); // 15 visits no longer enough once the target is raised to 20
  });

  it('is not reward-eligible with enough visits but zero completed challenges', async () => {
    const { service, prisma } = makeHarness();
    prisma.attendance.count.mockResolvedValue(15);
    prisma.gameAttempt.count.mockResolvedValue(0);

    const result = await service.getMonthlyProgress(prisma, 'cust-1');

    expect(result.visitsComplete).toBe(true);
    expect(result.challengeComplete).toBe(false);
    expect(result.rewardEligible).toBe(false);
  });

  it('is not reward-eligible with a completed challenge but one visit short of target', async () => {
    const { service, prisma } = makeHarness();
    prisma.attendance.count.mockResolvedValue(14);
    prisma.gameAttempt.count.mockResolvedValue(1);

    const result = await service.getMonthlyProgress(prisma, 'cust-1');

    expect(result.rewardEligible).toBe(false);
  });

  it('is genuinely reward-eligible only once BOTH conditions are met — the exact combined rule from the spec', async () => {
    const { service, prisma } = makeHarness();
    prisma.attendance.count.mockResolvedValue(15);
    prisma.gameAttempt.count.mockResolvedValue(1);

    const result = await service.getMonthlyProgress(prisma, 'cust-1');

    expect(result.rewardEligible).toBe(true);
  });

  it('only counts GENUINELY completed challenges (didWin: true) toward the requirement, not every attempt', async () => {
    const { service, prisma } = makeHarness();
    prisma.attendance.count.mockResolvedValue(15);
    prisma.gameAttempt.count.mockResolvedValue(0);

    await service.getMonthlyProgress(prisma, 'cust-1');

    expect(prisma.gameAttempt.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ didWin: true }) }),
    );
  });

  it('counts visits within the current calendar month only, not lifetime', async () => {
    const { service, prisma } = makeHarness();

    await service.getMonthlyProgress(prisma, 'cust-1');

    const call = prisma.attendance.count.mock.calls[0][0];
    expect(call.where.visitDate.gte).toBeInstanceOf(Date);
    expect(call.where.visitDate.lt).toBeInstanceOf(Date);
    expect(call.where.visitDate.lt.getTime()).toBeGreaterThan(call.where.visitDate.gte.getTime());
  });
});
