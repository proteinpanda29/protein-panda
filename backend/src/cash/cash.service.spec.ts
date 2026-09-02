import { CashService } from './cash.service';

function makeHarness() {
  const prisma: any = {
    cashShift: { findFirst: jest.fn(), create: jest.fn(), findUniqueOrThrow: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    cashExpense: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    refund: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const businessDayLock = { assertNotClosed: jest.fn().mockResolvedValue(undefined), isTodayClosed: jest.fn().mockResolvedValue(false) } as any;
  const service = new CashService(prisma, businessDayLock);
  return { service, prisma, businessDayLock };
}

describe('CashService.openShift', () => {
  it('rejects a negative opening cash amount', async () => {
    const { service } = makeHarness();
    await expect(service.openShift('user-1', -50)).rejects.toThrow(/cannot be negative/);
  });

  it('rejects opening a shift while one is already open', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findFirst.mockResolvedValue({ id: 'shift-existing', status: 'OPEN' });

    await expect(service.openShift('user-1', 2000)).rejects.toThrow(/already open/);
  });

  it('creates a shift with the declared opening cash', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findFirst.mockResolvedValue(null);
    prisma.cashShift.create.mockResolvedValue({});

    await service.openShift('user-1', 2000);

    expect(prisma.cashShift.create).toHaveBeenCalledWith({
      data: { openedByUserId: 'user-1', openingCashRs: 2000 },
    });
  });
});

describe('CashService.recordExpense', () => {
  it('rejects a non-positive amount', async () => {
    const { service } = makeHarness();
    await expect(service.recordExpense('shift-1', 0, 'ice')).rejects.toThrow(/must be positive/);
  });

  it('rejects a missing note', async () => {
    const { service } = makeHarness();
    await expect(service.recordExpense('shift-1', 50, '  ')).rejects.toThrow(/note is required/);
  });

  it('refuses to record an expense once today\'s business day has been closed', async () => {
    const { service, businessDayLock } = makeHarness();
    businessDayLock.assertNotClosed.mockRejectedValue(new Error("Today's business day has been closed"));

    await expect(service.recordExpense('shift-1', 50, 'ice')).rejects.toThrow(/business day has been closed/);
  });

  it('rejects recording an expense against a closed shift', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findUniqueOrThrow.mockResolvedValue({ id: 'shift-1', status: 'CLOSED' });

    await expect(service.recordExpense('shift-1', 50, 'ice')).rejects.toThrow(/already closed/);
  });

  it('creates the expense with a trimmed note for an open shift', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findUniqueOrThrow.mockResolvedValue({ id: 'shift-1', status: 'OPEN' });
    prisma.cashExpense.create.mockResolvedValue({});

    await service.recordExpense('shift-1', 50, '  Ice delivery  ');

    expect(prisma.cashExpense.create).toHaveBeenCalledWith({
      data: { shiftId: 'shift-1', amountRs: 50, note: 'Ice delivery' },
    });
  });
});

describe('CashService.closeShift', () => {
  it('rejects a negative closing cash amount', async () => {
    const { service } = makeHarness();
    await expect(service.closeShift('shift-1', 'user-1', -10)).rejects.toThrow(/cannot be negative/);
  });

  it('rejects closing an already-closed shift', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findUniqueOrThrow.mockResolvedValue({ id: 'shift-1', status: 'CLOSED' });

    await expect(service.closeShift('shift-1', 'user-1', 7000)).rejects.toThrow(/already closed/);
  });

  it('persists expectedCashRs and differenceRs computed at close time', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findUniqueOrThrow.mockResolvedValue({
      id: 'shift-1',
      status: 'OPEN',
      openedAt: new Date('2026-08-19T09:00:00Z'),
      openingCashRs: 2000,
    });
    prisma.payment.findMany.mockResolvedValue([{ amountRs: 5450 }]);
    prisma.refund.findMany.mockResolvedValue([]);
    prisma.cashExpense.findMany.mockResolvedValue([]);
    prisma.cashShift.update.mockResolvedValue({});

    await service.closeShift('shift-1', 'user-1', 7450);

    // expected = 2000 + 5450 = 7450; difference = 7450 - 7450 = 0
    expect(prisma.cashShift.update).toHaveBeenCalledWith({
      where: { id: 'shift-1' },
      data: expect.objectContaining({
        status: 'CLOSED',
        closedByUserId: 'user-1',
        closingCashRs: 7450,
        expectedCashRs: 7450,
        differenceRs: 0,
      }),
    });
  });

  it('computes a negative difference when the counted cash is short', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findUniqueOrThrow.mockResolvedValue({
      id: 'shift-1',
      status: 'OPEN',
      openedAt: new Date(),
      openingCashRs: 2000,
    });
    prisma.payment.findMany.mockResolvedValue([{ amountRs: 5450 }]);
    prisma.refund.findMany.mockResolvedValue([]);
    prisma.cashExpense.findMany.mockResolvedValue([]);
    prisma.cashShift.update.mockResolvedValue({});

    await service.closeShift('shift-1', 'user-1', 7380); // 70 short of the 7450 expected

    expect(prisma.cashShift.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ differenceRs: -70 }) }),
    );
  });
});

describe('CashService reconciliation math (computeBreakdown, via getCurrentShift)', () => {
  it('computes expected cash as opening + sales − refunds − expenses', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findFirst.mockResolvedValue({
      id: 'shift-1',
      openedAt: new Date('2026-08-19T09:00:00Z'),
      openingCashRs: 2000,
    });
    prisma.payment.findMany.mockResolvedValue([{ amountRs: 3000 }, { amountRs: 2600 }]);
    prisma.refund.findMany.mockResolvedValue([{ amountRs: 150 }]);
    prisma.cashExpense.findMany.mockResolvedValue([{ amountRs: 70 }]);

    const result = await service.getCurrentShift();

    // 2000 + (3000+2600) - 150 - 70 = 7380
    expect(result?.expectedCashRs).toBe(7380);
  });

  it('treats no cash activity at all as zero, not an error', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findFirst.mockResolvedValue({ id: 'shift-1', openedAt: new Date(), openingCashRs: 2000 });

    const result = await service.getCurrentShift();

    expect(result?.cashSalesRs).toBe(0);
    expect(result?.cashRefundsRs).toBe(0);
    expect(result?.cashExpensesRs).toBe(0);
    expect(result?.expectedCashRs).toBe(2000);
  });

  it('only sums CASH payments/refunds, filtered by the shift time window', async () => {
    const { service, prisma } = makeHarness();
    const openedAt = new Date('2026-08-19T09:00:00Z');
    prisma.cashShift.findFirst.mockResolvedValue({ id: 'shift-1', openedAt, openingCashRs: 2000 });

    await service.getCurrentShift();

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ method: 'CASH', status: 'PAID', paidAt: expect.objectContaining({ gte: openedAt }) }) }),
    );
    expect(prisma.refund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ method: 'CASH', status: 'COMPLETED', completedAt: expect.objectContaining({ gte: openedAt }) }) }),
    );
  });
});

describe('CashService.getCurrentShift', () => {
  it('returns null when no shift is open', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findFirst.mockResolvedValue(null);

    await expect(service.getCurrentShift()).resolves.toBeNull();
  });
});

describe('CashService.getShift', () => {
  it('throws NotFoundException when the shift does not exist', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findUnique.mockResolvedValue(null);

    await expect(service.getShift('missing-id')).rejects.toThrow(/not found/i);
  });

  it('adds live breakdown figures for an OPEN shift', async () => {
    const { service, prisma } = makeHarness();
    prisma.cashShift.findUnique.mockResolvedValue({ id: 'shift-1', status: 'OPEN', openedAt: new Date(), openingCashRs: 2000 });

    const result = await service.getShift('shift-1');

    expect(result.expectedCashRs).toBeDefined();
  });

  it('returns a CLOSED shift as-is without recomputing (already persisted at close time)', async () => {
    const { service, prisma } = makeHarness();
    const closedShift = { id: 'shift-1', status: 'CLOSED', expectedCashRs: 7450, differenceRs: 0 };
    prisma.cashShift.findUnique.mockResolvedValue(closedShift);

    const result = await service.getShift('shift-1');

    expect(result).toEqual(closedShift);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });
});

describe('CashService.getReconciliationReport', () => {
  it('groups real sales by payment method with correct counts and totals', async () => {
    const { service, prisma } = makeHarness();
    prisma.payment.findMany.mockResolvedValue([
      { method: 'UPI', amountRs: 500 },
      { method: 'UPI', amountRs: 300 },
      { method: 'CASH', amountRs: 150 },
    ]);

    const result = await service.getReconciliationReport('2026-01-01', '2026-01-31');

    expect(result.salesByMethod.UPI).toEqual({ count: 2, totalRs: 800 });
    expect(result.salesByMethod.CASH).toEqual({ count: 1, totalRs: 150 });
  });

  it('flags a PAID online payment with no transaction reference as a real inconsistency', async () => {
    const { service, prisma } = makeHarness();
    prisma.payment.findMany
      .mockResolvedValueOnce([]) // sales-by-method query
      .mockResolvedValueOnce([{ id: 'pay-1', method: 'UPI', order: { orderNumber: 'PP0042' } }]) // missing ref query
      .mockResolvedValueOnce([]); // stuck pending query

    const result = await service.getReconciliationReport('2026-01-01', '2026-01-31');

    expect(result.missingTransactionRefs).toHaveLength(1);
    expect(result.missingTransactionRefs[0].order.orderNumber).toBe('PP0042');
  });

  it('only ever checks UPI/CARD for missing transaction refs, never CASH (which legitimately has none)', async () => {
    const { service, prisma } = makeHarness();

    await service.getReconciliationReport('2026-01-01', '2026-01-31');

    const missingRefCall = prisma.payment.findMany.mock.calls[1][0];
    expect(missingRefCall.where.method.in).toEqual(['UPI', 'CARD']);
  });

  it('flags payments still PENDING after more than 24 hours as likely-abandoned checkouts', async () => {
    const { service, prisma } = makeHarness();
    prisma.payment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'pay-2', status: 'PENDING', order: { orderNumber: 'PP0099' } }]);

    const result = await service.getReconciliationReport('2026-01-01', '2026-01-31');

    expect(result.stuckPendingPayments).toHaveLength(1);
  });

  it('returns empty breakdowns, not a crash, for a window with no activity at all', async () => {
    const { service } = makeHarness();

    const result = await service.getReconciliationReport('2026-01-01', '2026-01-31');

    expect(result.salesByMethod).toEqual({});
    expect(result.refundsByMethod).toEqual({});
    expect(result.missingTransactionRefs).toEqual([]);
    expect(result.stuckPendingPayments).toEqual([]);
  });
});
