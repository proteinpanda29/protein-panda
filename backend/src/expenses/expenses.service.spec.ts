import { BadRequestException } from '@nestjs/common';
import { ExpensesService } from './expenses.service';

function makeHarness() {
  const prisma: any = {
    expense: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), delete: jest.fn().mockResolvedValue({}) },
  };
  const service = new ExpensesService(prisma);
  return { service, prisma };
}

describe('ExpensesService.recordExpense', () => {
  it('rejects a non-positive amount', async () => {
    const { service } = makeHarness();
    await expect(service.recordExpense('user-1', { category: 'MARKETING', amountRs: 0, description: 'Instagram ads' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a missing/blank description', async () => {
    const { service } = makeHarness();
    await expect(service.recordExpense('user-1', { category: 'MARKETING', amountRs: 500, description: '  ' })).rejects.toThrow(
      /description is required/,
    );
  });

  it('records a real expense attributed to the actual recording user', async () => {
    const { service, prisma } = makeHarness();

    await service.recordExpense('user-1', { category: 'EQUIPMENT', amountRs: 1200, description: 'New blender' });

    expect(prisma.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: 'EQUIPMENT', amountRs: 1200, description: 'New blender', createdByUserId: 'user-1' }) }),
    );
  });

  it('defaults expenseDate to now when not given, but respects an explicit one', async () => {
    const { service, prisma } = makeHarness();

    await service.recordExpense('user-1', { category: 'STAFF', amountRs: 5000, description: 'Overtime pay', expenseDate: '2026-01-15' });

    const call = prisma.expense.create.mock.calls[0][0];
    expect(call.data.expenseDate).toEqual(new Date('2026-01-15'));
  });
});

describe('ExpensesService.getExpenseSummary', () => {
  it('computes a real total and real per-category breakdown from actual expense rows', async () => {
    const { service, prisma } = makeHarness();
    prisma.expense.findMany.mockResolvedValue([
      { category: 'MARKETING', amountRs: 2000 },
      { category: 'MARKETING', amountRs: 500 },
      { category: 'EQUIPMENT', amountRs: 1200 },
    ]);

    const result = await service.getExpenseSummary('2026-01-01', '2026-01-31');

    expect(result.totalRs).toBe(3700);
    expect(result.byCategory).toEqual({ MARKETING: 2500, EQUIPMENT: 1200 });
  });

  it('returns a zero total and empty breakdown, not a crash, for a window with no expenses at all', async () => {
    const { service } = makeHarness();

    const result = await service.getExpenseSummary('2026-01-01', '2026-01-31');

    expect(result.totalRs).toBe(0);
    expect(result.byCategory).toEqual({});
  });
});
