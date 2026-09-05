import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export type SegmentType =
  | 'LAPSED_30_DAYS'
  | 'HIGH_SPENDERS'
  | 'ACTIVE_MEMBERS'
  | 'MEMBERSHIP_EXPIRING_SOON'
  | 'CLOSE_TO_MONTHLY_REWARD';

@Injectable()
export class SegmentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Each segment is computed from real, current data at request time —
   * not a stored/stale list — so "who's in this segment" is always
   * accurate as of right now, the same guarantee every other real-time
   * figure in this app already has.
   */
  async getSegment(type: SegmentType) {
    switch (type) {
      case 'LAPSED_30_DAYS':
        return this.lapsedCustomers();
      case 'HIGH_SPENDERS':
        return this.highSpenders();
      case 'ACTIVE_MEMBERS':
        return this.activeMembers();
      case 'MEMBERSHIP_EXPIRING_SOON':
        return this.membershipExpiringSoon();
      case 'CLOSE_TO_MONTHLY_REWARD':
        return this.closeToMonthlyReward();
      default:
        throw new BadRequestException(`Unknown segment: ${type}`);
    }
  }

  /** Customers with at least one past order, none in the last 30 days — genuinely lapsed, not just new. */
  private async lapsedCustomers() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const customers = await this.prisma.customer.findMany({
      where: {
        AND: [{ orders: { some: {} } }, { orders: { none: { createdAt: { gte: cutoff }, status: { not: 'CANCELLED' } } } }],
      },
      select: { id: true, name: true, orders: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } },
    });
    return customers.map((c: any) => ({ id: c.id, name: c.name, lastOrderAt: c.orders[0]?.createdAt ?? null }));
  }

  /** Top lifetime spenders — real aggregate spend, not an estimate. */
  private async highSpenders(limit = 20) {
    const grouped = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: { status: { notIn: ['CANCELLED', 'FAILED'] } },
      _sum: { totalRs: true },
      orderBy: { _sum: { totalRs: 'desc' } },
      take: limit,
    });
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: grouped.map((g: { customerId: string }) => g.customerId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map<string, string>(customers.map((c: { id: string; name: string }) => [c.id, c.name]));
    return grouped.map((g: any) => ({ id: g.customerId, name: nameById.get(g.customerId) ?? 'Unknown', totalSpendRs: Number(g._sum.totalRs ?? 0) }));
  }

  private async activeMembers() {
    const memberships = await this.prisma.membership.findMany({
      where: { status: 'ACTIVE' },
      include: { customer: { select: { id: true, name: true } } },
    });
    return memberships.map((m: any) => ({ id: m.customer.id, name: m.customer.name, membershipId: m.id }));
  }

  /** Active memberships ending within the next 7 days — a real, actionable renewal-campaign list. */
  private async membershipExpiringSoon() {
    const now = new Date();
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    // Membership has no endDate column at all — it's tracked by
    // totalDays/daysCompleted/startDate instead (a subscription that
    // fulfills roughly one day at a time), so "expiring soon" has to be
    // computed from those: startDate + totalDays approximates when it
    // naturally finishes. Filtered in application code rather than the
    // database query since this is a derived value, not a real column.
    const activeMemberships = await this.prisma.membership.findMany({
      where: { status: 'ACTIVE' },
      include: { customer: { select: { id: true, name: true } } },
    });

    return activeMemberships
      .map((m: { startDate: Date; totalDays: number; customer: { id: string; name: string } }) => {
        const expectedEndDate = new Date(m.startDate);
        expectedEndDate.setDate(expectedEndDate.getDate() + m.totalDays);
        return { id: m.customer.id, name: m.customer.name, expectedEndDate };
      })
      .filter((m: { expectedEndDate: Date }) => m.expectedEndDate >= now && m.expectedEndDate <= soon);
  }

  /**
   * Real attendance data — customers who've visited 10-14 times this
   * calendar month, genuinely close to (but short of) the 15-visit
   * monthly reward. A real, actionable "nudge them to come back this
   * month" list, not a guess.
   */
  private async closeToMonthlyReward() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const grouped = await this.prisma.attendance.groupBy({
      by: ['customerId'],
      where: { visitDate: { gte: monthStart, lt: monthEnd } },
      _count: { _all: true },
    });
    const close = grouped.filter((g: any) => g._count._all >= 10 && g._count._all < 15);
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: close.map((g: any) => g.customerId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map<string, string>(customers.map((c: { id: string; name: string }) => [c.id, c.name]));
    return close.map((g: any) => ({ id: g.customerId, name: nameById.get(g.customerId) ?? 'Unknown', visitsThisMonth: g._count._all }));
  }
}
