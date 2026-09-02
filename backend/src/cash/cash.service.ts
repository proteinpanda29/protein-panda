import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { BusinessDayLockService } from '../common/business-day-lock.service';

@Injectable()
export class CashService {
  constructor(
    private prisma: PrismaService,
    private businessDayLock: BusinessDayLockService,
  ) {}

  async getCurrentShift() {
    const shift = await this.prisma.cashShift.findFirst({
      where: { status: 'OPEN' },
      include: { expenses: true },
    });
    if (!shift) return null;
    return { ...shift, ...(await this.computeBreakdown(shift, new Date())) };
  }

  async openShift(userId: string, openingCashRs: number) {
    if (openingCashRs < 0) throw new BadRequestException('Opening cash cannot be negative');

    const alreadyOpen = await this.prisma.cashShift.findFirst({ where: { status: 'OPEN' } });
    if (alreadyOpen) throw new BadRequestException('A shift is already open — close it before opening a new one');

    return this.prisma.cashShift.create({
      data: { openedByUserId: userId, openingCashRs },
    });
  }

  async recordExpense(shiftId: string, amountRs: number, note: string) {
    if (amountRs <= 0) throw new BadRequestException('Expense amount must be positive');
    if (!note?.trim()) throw new BadRequestException('A note is required for every cash expense');
    // Defense-in-depth alongside the shift-status check below — a cash
    // adjustment is exactly the kind of "sensitive modification" the
    // spec calls out by name for the closed-day lock.
    await this.businessDayLock.assertNotClosed('recording a cash expense');

    const shift = await this.prisma.cashShift.findUniqueOrThrow({ where: { id: shiftId } });
    if (shift.status !== 'OPEN') throw new BadRequestException('This shift is already closed');

    return this.prisma.cashExpense.create({ data: { shiftId, amountRs, note: note.trim() } });
  }

  /**
   * Closes the drawer: computes what SHOULD be in it (opening float +
   * real CASH sales - real CASH refunds - logged expenses, all scoped to
   * this shift's exact time window) and compares against what the
   * counted cash actually is. The difference is the number that matters
   * — it catches theft, miscounts, or an off-book discount nobody logged
   * properly, none of which "total sales today" alone would ever surface.
   */
  async closeShift(shiftId: string, userId: string, closingCashRs: number) {
    if (closingCashRs < 0) throw new BadRequestException('Closing cash cannot be negative');

    const shift = await this.prisma.cashShift.findUniqueOrThrow({ where: { id: shiftId } });
    if (shift.status !== 'OPEN') throw new BadRequestException('This shift is already closed');

    const closedAt = new Date();
    const breakdown = await this.computeBreakdown(shift, closedAt);
    const differenceRs = closingCashRs - breakdown.expectedCashRs;

    return this.prisma.cashShift.update({
      where: { id: shiftId },
      data: {
        closedByUserId: userId,
        closingCashRs,
        expectedCashRs: breakdown.expectedCashRs,
        differenceRs,
        closedAt,
        status: 'CLOSED',
      },
    });
  }

  async listShifts() {
    return this.prisma.cashShift.findMany({
      orderBy: { openedAt: 'desc' },
      take: 60,
      include: {
        openedByUser: { select: { staff: { select: { name: true } } } },
        closedByUser: { select: { staff: { select: { name: true } } } },
        expenses: true,
      },
    });
  }

  async getShift(id: string) {
    const shift = await this.prisma.cashShift.findUnique({
      where: { id },
      include: {
        openedByUser: { select: { staff: { select: { name: true } } } },
        closedByUser: { select: { staff: { select: { name: true } } } },
        expenses: true,
      },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.status === 'OPEN') {
      return { ...shift, ...(await this.computeBreakdown(shift, new Date())) };
    }
    return shift;
  }

  private async computeBreakdown(shift: { id: string; openingCashRs: unknown; openedAt: Date }, windowEnd: Date) {
    const [cashSales, cashRefunds, expenses] = await Promise.all([
      this.prisma.payment.findMany({
        where: { method: 'CASH', status: 'PAID', paidAt: { gte: shift.openedAt, lte: windowEnd } },
        select: { amountRs: true },
      }),
      this.prisma.refund.findMany({
        where: { method: 'CASH', status: 'COMPLETED', completedAt: { gte: shift.openedAt, lte: windowEnd } },
        select: { amountRs: true },
      }),
      this.prisma.cashExpense.findMany({ where: { shiftId: shift.id }, select: { amountRs: true } }),
    ]);

    const cashSalesRs = cashSales.reduce((sum: number, p: { amountRs: unknown }) => sum + Number(p.amountRs), 0);
    const cashRefundsRs = cashRefunds.reduce((sum: number, r: { amountRs: unknown }) => sum + Number(r.amountRs), 0);
    const cashExpensesRs = expenses.reduce((sum: number, e: { amountRs: unknown }) => sum + Number(e.amountRs), 0);
    const expectedCashRs = Number(shift.openingCashRs) + cashSalesRs - cashRefundsRs - cashExpensesRs;

    return {
      cashSalesRs,
      cashSalesCount: cashSales.length,
      cashRefundsRs,
      cashExpensesRs,
      expectedCashRs,
    };
  }

  /**
   * Real payment reconciliation — not a cash-shift-specific report like
   * the ones above, this spans every payment method for a date range.
   * Surfaces two genuine categories of inconsistency a business owner
   * actually needs to catch: a payment marked PAID via an online
   * gateway method with no transaction reference on file at all (which
   * should never happen if it genuinely cleared Razorpay), and
   * payments stuck PENDING for more than 24 hours (likely abandoned at
   * checkout, worth following up on or writing off).
   */
  async getReconciliationReport(dateFrom: string, dateTo: string) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    const [paidPayments, refunds, suspiciousPaid, stuckPending] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: 'PAID', paidAt: { gte: from, lte: to } },
        select: { method: true, amountRs: true },
      }),
      this.prisma.refund.findMany({
        where: { status: 'COMPLETED', completedAt: { gte: from, lte: to } },
        select: { method: true, amountRs: true },
      }),
      this.prisma.payment.findMany({
        where: { status: 'PAID', method: { in: ['UPI', 'CARD'] }, transactionRef: null, paidAt: { gte: from, lte: to } },
        include: { order: { select: { orderNumber: true } } },
      }),
      this.prisma.payment.findMany({
        where: { status: 'PENDING', createdAt: { lte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        include: { order: { select: { orderNumber: true, createdAt: true } } },
      }),
    ]);

    const byMethod: Record<string, { count: number; totalRs: number }> = {};
    for (const p of paidPayments) {
      const key = p.method;
      byMethod[key] = byMethod[key] ?? { count: 0, totalRs: 0 };
      byMethod[key].count += 1;
      byMethod[key].totalRs += Number(p.amountRs);
    }

    const refundsByMethod: Record<string, { count: number; totalRs: number }> = {};
    for (const r of refunds) {
      const key = r.method;
      refundsByMethod[key] = refundsByMethod[key] ?? { count: 0, totalRs: 0 };
      refundsByMethod[key].count += 1;
      refundsByMethod[key].totalRs += Number(r.amountRs);
    }

    return {
      salesByMethod: byMethod,
      refundsByMethod,
      // "Missing transaction" — paid via a gateway method with no
      // reference on file, a real data-integrity problem to flag.
      missingTransactionRefs: suspiciousPaid,
      // Likely-abandoned checkouts — never confirmed, more than a day old.
      stuckPendingPayments: stuckPending,
    };
  }
}
