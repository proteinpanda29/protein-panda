import { BadRequestException } from '@nestjs/common';
import { SegmentsService } from './segments.service';

function makeHarness() {
  const prisma: any = {
    customer: { findMany: jest.fn().mockResolvedValue([]) },
    order: { groupBy: jest.fn().mockResolvedValue([]) },
    membership: { findMany: jest.fn().mockResolvedValue([]) },
    attendance: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const service = new SegmentsService(prisma);
  return { service, prisma };
}

describe('SegmentsService.getSegment', () => {
  it('rejects an unknown segment type', async () => {
    const { service } = makeHarness();
    await expect(service.getSegment('NOT_A_REAL_SEGMENT' as any)).rejects.toThrow(BadRequestException);
  });

  it('LAPSED_30_DAYS: queries for customers with a past order but none in the last 30 days, not a broken duplicate-key filter', async () => {
    const { service, prisma } = makeHarness();

    await service.getSegment('LAPSED_30_DAYS');

    const call = prisma.customer.findMany.mock.calls[0][0];
    expect(call.where.AND).toHaveLength(2);
    expect(call.where.AND[0]).toEqual({ orders: { some: {} } });
    expect(call.where.AND[1].orders.none).toBeDefined();
  });

  it('HIGH_SPENDERS: ranks by real aggregate spend, attaching the real customer name', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.groupBy.mockResolvedValue([{ customerId: 'cust-1', _sum: { totalRs: 5000 } }]);
    prisma.customer.findMany.mockResolvedValue([{ id: 'cust-1', name: 'Rahul' }]);

    const result = await service.getSegment('HIGH_SPENDERS');

    expect(result).toEqual([{ id: 'cust-1', name: 'Rahul', totalSpendRs: 5000 }]);
  });

  it('HIGH_SPENDERS: excludes cancelled/failed orders from the ranking', async () => {
    const { service, prisma } = makeHarness();

    await service.getSegment('HIGH_SPENDERS');

    const call = prisma.order.groupBy.mock.calls[0][0];
    expect(call.where.status.notIn).toEqual(['CANCELLED', 'FAILED']);
  });

  it('ACTIVE_MEMBERS: only queries genuinely ACTIVE memberships, not expired/cancelled ones', async () => {
    const { service, prisma } = makeHarness();

    await service.getSegment('ACTIVE_MEMBERS');

    const call = prisma.membership.findMany.mock.calls[0][0];
    expect(call.where.status).toBe('ACTIVE');
  });

  it('MEMBERSHIP_EXPIRING_SOON: only looks within the next 7 days, not all future expirations', async () => {
    const { service, prisma } = makeHarness();

    await service.getSegment('MEMBERSHIP_EXPIRING_SOON');

    const call = prisma.membership.findMany.mock.calls[0][0];
    const rangeDays = (call.where.endDate.lte.getTime() - call.where.endDate.gte.getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(rangeDays)).toBe(7);
  });

  it('CLOSE_TO_MONTHLY_REWARD: includes customers with 10-14 visits, excludes those with fewer than 10 or already at 15', async () => {
    const { service, prisma } = makeHarness();
    prisma.attendance.groupBy.mockResolvedValue([
      { customerId: 'cust-low', _count: { _all: 5 } },
      { customerId: 'cust-close', _count: { _all: 12 } },
      { customerId: 'cust-done', _count: { _all: 15 } },
    ]);
    prisma.customer.findMany.mockResolvedValue([{ id: 'cust-close', name: 'Priya' }]);

    const result = await service.getSegment('CLOSE_TO_MONTHLY_REWARD');

    expect(result).toEqual([{ id: 'cust-close', name: 'Priya', visitsThisMonth: 12 }]);
  });
});
