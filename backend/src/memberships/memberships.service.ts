import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { FulfillmentType, PaymentMethod, OrderChannel } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { OrdersService } from '../orders/orders.service';

const isSameCalendarDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

@Injectable()
export class MembershipsService {
  constructor(
    private prisma: PrismaService,
    private orders: OrdersService,
  ) {}

  async create(customerId: string, input: {
    totalDays: number;
    scheduledTime: string;
    fulfillmentType: FulfillmentType;
    items: { productId: string; quantity: number }[];
    deliveryAddress?: string;
    deliveryContactPhone?: string;
  }) {
    if (!input.items.length) throw new BadRequestException('Choose at least one item for the plan');
    if (![7, 30].includes(input.totalDays)) {
      throw new BadRequestException('totalDays must be 7 (weekly) or 30 (monthly)');
    }
    if (!/^\d{2}:\d{2}$/.test(input.scheduledTime)) {
      throw new BadRequestException('scheduledTime must be in HH:MM format');
    }
    if (input.fulfillmentType === 'DELIVERY' && (!input.deliveryAddress || !input.deliveryContactPhone)) {
      throw new BadRequestException('A delivery address and contact phone are required for a delivery plan');
    }

    return this.prisma.membership.create({
      data: {
        customerId,
        totalDays: input.totalDays,
        scheduledTime: input.scheduledTime,
        fulfillmentType: input.fulfillmentType,
        deliveryAddress: input.deliveryAddress,
        deliveryContactPhone: input.deliveryContactPhone,
        items: { create: input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) },
      },
      include: { items: { include: { product: true } } },
    });
  }

  async listMine(customerId: string) {
    return this.prisma.membership.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: true } } },
    });
  }

  private async getOwned(customerId: string, membershipId: string) {
    const membership = await this.prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
    if (membership.customerId !== customerId) throw new ForbiddenException('This membership does not belong to you');
    return membership;
  }

  async pause(customerId: string, membershipId: string) {
    await this.getOwned(customerId, membershipId);
    return this.prisma.membership.update({ where: { id: membershipId }, data: { status: 'PAUSED' } });
  }

  async resume(customerId: string, membershipId: string) {
    const membership = await this.getOwned(customerId, membershipId);
    if (membership.status === 'CANCELLED' || membership.status === 'COMPLETED') {
      throw new BadRequestException('This plan has ended and cannot be resumed');
    }
    return this.prisma.membership.update({ where: { id: membershipId }, data: { status: 'ACTIVE' } });
  }

  async cancel(customerId: string, membershipId: string) {
    await this.getOwned(customerId, membershipId);
    return this.prisma.membership.update({ where: { id: membershipId }, data: { status: 'CANCELLED' } });
  }

  /** Skips the NEXT scheduled generation only — plan stays active afterward. */
  async skipNext(customerId: string, membershipId: string) {
    await this.getOwned(customerId, membershipId);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return this.prisma.membership.update({ where: { id: membershipId }, data: { skipNextDate: tomorrow } });
  }

  async updateScheduledTime(customerId: string, membershipId: string, scheduledTime: string) {
    await this.getOwned(customerId, membershipId);
    if (!/^\d{2}:\d{2}$/.test(scheduledTime)) throw new BadRequestException('scheduledTime must be in HH:MM format');
    return this.prisma.membership.update({ where: { id: membershipId }, data: { scheduledTime } });
  }

  /**
   * Runs every minute (see MembershipCronService). Finds ACTIVE memberships
   * whose scheduledTime matches the current HH:MM, that haven't already
   * generated an order today, and aren't skipped for today — then places
   * the order by reusing the exact same validated order-creation pipeline
   * everything else in the app uses (allergen checks, pricing, points,
   * streak, nutrition logging all happen identically to a manual order).
   */
  async generateDueOrders(now: Date) {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const due = await this.prisma.membership.findMany({
      where: { status: 'ACTIVE', scheduledTime: hhmm },
      include: { items: true },
    });

    const results: { membershipId: string; orderId?: string; skipped?: string }[] = [];

    for (const membership of due) {
      if (membership.lastOrderDate && isSameCalendarDay(membership.lastOrderDate, now)) {
        results.push({ membershipId: membership.id, skipped: 'already generated today' });
        continue;
      }
      if (membership.skipNextDate && isSameCalendarDay(membership.skipNextDate, now)) {
        await this.prisma.membership.update({ where: { id: membership.id }, data: { skipNextDate: null } });
        results.push({ membershipId: membership.id, skipped: 'customer skipped today' });
        continue;
      }

      try {
        const order = await this.orders.create({
          customerId: membership.customerId,
          channel: OrderChannel.MEMBERSHIP,
          fulfillmentType: membership.fulfillmentType,
          paymentMethod: PaymentMethod.CASH, // membership orders settle at pickup/delivery, same as pay-at-counter
          items: membership.items.map((i: { productId: string; quantity: number }) => ({ productId: i.productId, quantity: i.quantity })),
          ...(membership.fulfillmentType === 'DELIVERY'
            ? { deliveryAddress: membership.deliveryAddress!, deliveryContactPhone: membership.deliveryContactPhone! }
            : {}),
        });

        const daysCompleted = membership.daysCompleted + 1;
        await this.prisma.membership.update({
          where: { id: membership.id },
          data: {
            lastOrderDate: now,
            daysCompleted,
            ...(daysCompleted >= membership.totalDays ? { status: 'COMPLETED' } : {}),
          },
        });

        results.push({ membershipId: membership.id, orderId: order.id });
      } catch (err) {
        // A single failed membership (e.g. a product went inactive) should
        // never block the rest of the day's scheduled orders from generating.
        results.push({ membershipId: membership.id, skipped: `error: ${(err as Error).message}` });
      }
    }

    return results;
  }
}
