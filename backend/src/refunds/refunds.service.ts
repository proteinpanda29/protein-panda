import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PointsService } from '../points/points.service';
import { InventoryService } from '../inventory/inventory.service';
import { RazorpayService } from '../payments/razorpay.service';
import { WalletService } from '../customers/wallet.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BusinessDayLockService } from '../common/business-day-lock.service';

const SELF_CANCEL_ALLOWED_STATUSES = ['RECEIVED', 'ACCEPTED'];

@Injectable()
export class RefundsService {
  private logger = new Logger('RefundsService');

  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private inventory: InventoryService,
    private razorpay: RazorpayService,
    private wallet: WalletService,
    private auditLog: AuditLogService,
    private businessDayLock: BusinessDayLockService,
  ) {}

  /**
   * Full cancellation — the customer- or admin-initiated path that
   * actually stops the order. Reverses everything that was granted
   * because of it (inventory, and points/goal-bonus if payment was
   * confirmed), then triggers a refund for whatever was actually paid.
   *
   * Deliberately does NOT reverse:
   * - Streak credit: a cancelled order might not be the only qualifying
   *   activity that day, so un-crediting a streak day here could
   *   incorrectly break a streak the customer earned through something
   *   else entirely. Left alone rather than guessed at.
   * - Achievements: treated as permanent milestone recognitions once
   *   unlocked, not something a later cancellation revokes — matches how
   *   most loyalty programs treat badges vs. spendable currency.
   */
  async cancelOrder(
    orderId: string,
    params: { reason: string; initiatedByUserId?: string; isCustomerInitiated: boolean; customerId?: string },
  ) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { payment: true, items: true },
    });

    if (params.isCustomerInitiated && order.customerId !== params.customerId) {
      throw new BadRequestException('This order does not belong to you');
    }
    if (order.status === 'CANCELLED') throw new BadRequestException('This order is already cancelled');
    if (order.status === 'DELIVERED') {
      throw new BadRequestException('Delivered orders cannot be cancelled — process a refund instead');
    }
    if (params.isCustomerInitiated && !SELF_CANCEL_ALLOWED_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        'This order has already started preparing and can no longer be self-cancelled — please contact the shop',
      );
    }
    if (!params.reason?.trim()) throw new BadRequestException('A cancellation reason is required');

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancellationReason: params.reason },
      });

      // Stock is deducted at order creation regardless of payment status
      // (see OrdersService.create), so it must always be restocked on
      // cancellation, paid or not.
      await this.inventory.restockForOrder(
        tx,
        orderId,
        order.items.map((i: { productId: string; quantity: number }) => ({ productId: i.productId, quantity: i.quantity })),
      );

      // Points/goal-bonus were only ever granted once payment was
      // actually confirmed (see the order-creation payment-gating rule),
      // so only reverse them when that happened.
      if (order.payment && order.payment.status === 'PAID') {
        const earnedEntries = await tx.pointsLedgerEntry.findMany({
          where: { orderId, points: { gt: 0 } },
        });
        const totalEarned = earnedEntries.reduce((sum: number, e: { points: number }) => sum + e.points, 0);
        if (totalEarned > 0) {
          await this.points.award(tx, {
            customerId: order.customerId,
            points: -totalEarned,
            sourceType: 'REFUND_REVERSAL',
            orderId,
            note: `Reversed — order ${order.orderNumber} cancelled`,
          });
        }
      }
    });

    let refund = null;
    if (order.payment && order.payment.status === 'PAID') {
      const refundableRs = Number(order.payment.amountRs) - Number(order.refundedRs);
      if (refundableRs > 0) {
        refund = await this.processRefund(orderId, params.initiatedByUserId, {
          amountRs: refundableRs,
          reason: params.reason,
        });
      }
    }

    return { cancelled: true, refund };
  }

  /**
   * Financial-only refund — for cases that don't warrant (or have
   * already passed) full cancellation: a delivered order with a
   * complaint, a missing item, a partial goodwill refund. Does NOT touch
   * order status, inventory, or points — those are ambiguous for a
   * partial amount (which items? how many points?) and are left to
   * manual admin judgement rather than guessed at automatically.
   */
  async processRefund(orderId: string, adminUserId: string | undefined, params: { amountRs: number; reason: string; method?: 'CASH' | 'RAZORPAY' | 'WALLET' }) {
    if (params.amountRs <= 0) throw new BadRequestException('Refund amount must be positive');
    if (!params.reason?.trim()) throw new BadRequestException('A refund reason is required');
    // Only gated for admin-initiated refunds — this is the shop's own
    // sensitive action the closed-day lock exists for, not something
    // that should block a customer's own order cancellation flow.
    if (adminUserId) await this.businessDayLock.assertNotClosed('processing a refund');

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    if (!order.payment || order.payment.status !== 'PAID') {
      throw new BadRequestException('This order has not been paid — there is nothing to refund');
    }

    const maxRefundableRs = Number(order.payment.amountRs) - Number(order.refundedRs);
    if (params.amountRs > maxRefundableRs) {
      throw new BadRequestException(`Cannot refund more than the remaining refundable amount (₹${maxRefundableRs.toFixed(2)})`);
    }

    // An explicit choice (e.g. "refund to wallet instead of the slow
    // gateway route") always wins; otherwise falls back to the
    // original auto-derived behavior — matching how the original
    // payment method was collected, same as before this method
    // parameter existed.
    const method = params.method ?? (order.payment.method === 'CASH' ? 'CASH' : 'RAZORPAY');
    const refund = await this.prisma.refund.create({
      data: {
        orderId,
        amountRs: params.amountRs,
        reason: params.reason,
        method,
        initiatedByUserId: adminUserId,
      },
    });

    if (adminUserId) {
      this.auditLog
        .record({
          actorUserId: adminUserId,
          actorRole: 'ADMIN',
          action: 'ORDER_REFUNDED',
          entityType: 'Order',
          entityId: orderId,
          summary: `Refunded ₹${params.amountRs} for order #${order.orderNumber} (${method}) — ${params.reason}`,
          metadata: { amountRs: params.amountRs, method, reason: params.reason },
        })
        .catch(() => undefined);
    }

    if (method === 'CASH') {
      // Stays PENDING until an admin confirms the cash was physically
      // handed back — see confirmCashRefund below.
      return refund;
    }

    if (method === 'WALLET') {
      // Completes instantly — no external gateway call, no counter
      // visit to wait on. This is the whole appeal of wallet refunds
      // over the other two methods.
      return this.completeRefund(refund.id);
    }

    // Online refund — call the gateway outside any DB transaction, same
    // pattern as payment confirmation: never hold a DB transaction open
    // across an external network call.
    try {
      const result = await this.razorpay.refundPayment(order.payment.transactionRef!, params.amountRs);
      return this.completeRefund(refund.id, result.id);
    } catch (err) {
      this.logger.error(`Razorpay refund failed for order ${orderId}: ${(err as Error).message}`);
      await this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED' } });
      throw new BadRequestException('The refund failed at the payment gateway — please try again or use a cash refund');
    }
  }

  /** Admin confirms a CASH refund was physically handed back to the customer. */
  async confirmCashRefund(refundId: string) {
    const refund = await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (refund.method !== 'CASH') throw new BadRequestException('Only cash refunds need manual confirmation');
    if (refund.status !== 'PENDING') throw new BadRequestException('This refund is not pending');

    return this.completeRefund(refundId);
  }

  private async completeRefund(refundId: string, razorpayRefundId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.update({
        where: { id: refundId },
        data: { status: 'COMPLETED', completedAt: new Date(), razorpayRefundId },
        include: { order: { include: { payment: true } } },
      });

      const newRefundedRs = Number(refund.order.refundedRs) + Number(refund.amountRs);
      await tx.order.update({ where: { id: refund.orderId }, data: { refundedRs: newRefundedRs } });

      if (refund.order.payment && newRefundedRs >= Number(refund.order.payment.amountRs)) {
        await tx.payment.update({ where: { id: refund.order.payment.id }, data: { status: 'REFUNDED' } });
      }

      // Actually move the money into the wallet — this is the part
      // that makes a WALLET-method refund real rather than just a
      // status label. Uses this same transaction, so a wallet credit
      // can never succeed while the refund record itself somehow fails
      // to save, or vice versa.
      if (refund.method === 'WALLET') {
        await this.wallet.credit(tx, {
          customerId: refund.order.customerId,
          amountRs: Number(refund.amountRs),
          type: 'REFUND',
          orderId: refund.orderId,
          refundId: refund.id,
          note: `Refund for order #${refund.order.orderNumber}`,
        });
      }

      return refund;
    });
  }

  async listRefundsForOrder(orderId: string) {
    return this.prisma.refund.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });
  }

  async listAllRefunds() {
    return this.prisma.refund.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        order: { select: { orderNumber: true, customer: { select: { name: true } } } },
        initiatedByUser: { select: { staff: { select: { name: true } } } },
      },
    });
  }
}
