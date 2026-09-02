import { StaffShiftsService } from './staff-shifts.service';

function makeHarness() {
  const prisma: any = {
    staffShift: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  };
  const service = new StaffShiftsService(prisma);
  return { service, prisma };
}

describe('StaffShiftsService.clockIn', () => {
  it('rejects clocking in when there is already an open shift', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findFirst.mockResolvedValue({ id: 'shift-1', clockedOutAt: null });

    await expect(service.clockIn('user-1')).rejects.toThrow(/Already clocked in/);
  });

  it('creates a new shift when no open one exists', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findFirst.mockResolvedValue(null);
    prisma.staffShift.create.mockResolvedValue({ id: 'shift-1' });

    await service.clockIn('user-1');

    expect(prisma.staffShift.create).toHaveBeenCalledWith({ data: { userId: 'user-1' } });
  });

  it('only checks for an open shift belonging to this specific user', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findFirst.mockResolvedValue(null);
    prisma.staffShift.create.mockResolvedValue({});

    await service.clockIn('user-1');

    expect(prisma.staffShift.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', clockedOutAt: null },
    });
  });
});

describe('StaffShiftsService.clockOut', () => {
  it('rejects clocking out when there is no open shift', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findFirst.mockResolvedValue(null);

    await expect(service.clockOut('user-1')).rejects.toThrow(/Not currently clocked in/);
  });

  it('closes the open shift with a timestamp and optional note', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findFirst.mockResolvedValue({ id: 'shift-1', clockedOutAt: null });
    prisma.staffShift.update.mockResolvedValue({});

    await service.clockOut('user-1', 'Covered an extra hour');

    expect(prisma.staffShift.update).toHaveBeenCalledWith({
      where: { id: 'shift-1' },
      data: { clockedOutAt: expect.any(Date), note: 'Covered an extra hour' },
    });
  });

  it('works without a note', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findFirst.mockResolvedValue({ id: 'shift-1', clockedOutAt: null });
    prisma.staffShift.update.mockResolvedValue({});

    await service.clockOut('user-1');

    expect(prisma.staffShift.update).toHaveBeenCalledWith({
      where: { id: 'shift-1' },
      data: { clockedOutAt: expect.any(Date), note: undefined },
    });
  });
});

describe('StaffShiftsService.getCurrentShift', () => {
  it('returns null when no shift is open', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findFirst.mockResolvedValue(null);

    await expect(service.getCurrentShift('user-1')).resolves.toBeNull();
  });

  it('returns the open shift when one exists', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findFirst.mockResolvedValue({ id: 'shift-1', clockedOutAt: null });

    const result = await service.getCurrentShift('user-1');

    expect(result?.id).toBe('shift-1');
  });
});

describe('StaffShiftsService.listAllShifts', () => {
  it('includes staff/rider name via the user relation for admin display', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findMany.mockResolvedValue([]);

    await service.listAllShifts();

    const call = prisma.staffShift.findMany.mock.calls[0][0];
    expect(call.include.user.select.staff).toBeDefined();
    expect(call.include.user.select.deliveryPerson).toBeDefined();
  });

  it('is not scoped to any particular user — this is the admin-wide view', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findMany.mockResolvedValue([]);

    await service.listAllShifts();

    const call = prisma.staffShift.findMany.mock.calls[0][0];
    expect(call.where.clockedInAt.gte).toBeUndefined();
    expect(call.where.clockedInAt.lte).toBeUndefined();
  });

  it('applies a date range filter when provided', async () => {
    const { service, prisma } = makeHarness();
    prisma.staffShift.findMany.mockResolvedValue([]);

    await service.listAllShifts({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });

    const call = prisma.staffShift.findMany.mock.calls[0][0];
    expect(call.where.clockedInAt.gte).toEqual(new Date('2026-08-01'));
    expect(call.where.clockedInAt.lte).toEqual(new Date('2026-08-31'));
  });
});
