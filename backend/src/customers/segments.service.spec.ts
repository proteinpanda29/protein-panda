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

  it('MEMBERSHIP_EXPIRING_SOON: includes a membership whose startDate + totalDays falls within the next 7 days', async () => {
    const { service, prisma } = makeHarness();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 27); // 27 days ago
    prisma.membership.findMany.mockResolvedValue([
      { startDate, totalDays: 30, customer: { id: 'cust-1', name: 'Ravi' } }, // ends in 3 days — expiring soon
    ]);

    const result = await service.getSegment('MEMBERSHIP_EXPIRING_SOON');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ id: 'cust-1', name: 'Ravi' }));
  });

  it('MEMBERSHIP_EXPIRING_SOON: excludes a membership that ended in the past or is not due for weeks', async () => {
    const { service, prisma } = makeHarness();
    const startedYesterday = new Date();
    startedYesterday.setDate(startedYesterday.getDate() - 1);
    const startedLongAgo = new Date();
    startedLongAgo.setDate(startedLongAgo.getDate() - 60);
    prisma.membership.findMany.mockResolvedValue([
      { startDate: startedYesterday, totalDays: 30, customer: { id: 'cust-1', name: 'Ravi' } }, // ends in ~29 days — not soon
      { startDate: startedLongAgo, totalDays: 30, customer: { id: 'cust-2', name: 'Priya' } }, // already ended
    ]);

    const result = await service.getSegment('MEMBERSHIP_EXPIRING_SOON');

    expect(result).toEqual([]);
  });

  it('MEMBERSHIP_EXPIRING_SOON: only ever queries memberships with status ACTIVE', async () => {
    const { service, prisma } = makeHarness();

    await service.getSegment('MEMBERSHIP_EXPIRING_SOON');

    const call = prisma.membership.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ status: 'ACTIVE' });
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
