import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { RazorpayService } from '../payments/razorpay.service';
import { BusinessRulesService } from '../common/business-rules.service';
import { EmailService } from '../notifications/email.service';

type Tx = any;

// The shop runs on Indian time. Day boundaries ("today", "day 3 of 7",
// "no order that day") must follow the shop's calendar, not the
// server's (Railway runs on UTC, which is 5.5 hours behind).
const SHOP_TZ = 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD for the given moment, on the shop's calendar. */
export function shopDateKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: SHOP_TZ });
}

function shopDayRange(d: Date) {
  const key = shopDateKey(d);
  return {
    key,
    start: new Date(`${key}T00:00:00+05:30`),
    end: new Date(`${key}T23:59:59.999+05:30`),
    // @db.Date columns store only the date part; UTC midnight of the
    // shop's date key keeps that date stable whatever the server's zone.
    billDate: new Date(`${key}T00:00:00.000Z`),
  };
}

/** Day number of `key` within a plan that started on `startKey` (start day = 1). */
function dayNumberOf(startKey: string, key: string): number {
  return Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / DAY_MS) + 1;
}

function addDaysToKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface SubscriptionPlanInput {
  planName: string;
  priceRs: number;
  packageFeeRs: number;
  creditRs: number;
  validityDays: number;
  source: 'ONLINE' | 'COUNTER';
  createdByUserId?: string;
  /** YYYY-MM-DD on the shop's calendar; lets staff record a plan that actually began earlier. Defaults to today. */
  startDate?: string;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface HistoryItemInput {
  name: string;
  quantity: number;
  amountRs: number;
}

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private razorpay: RazorpayService,
    private businessRules: BusinessRulesService,
    private email: EmailService,
  ) {}

  /** Creates the wallet on first use — most customers will never need one, so it's not created at signup. */
  private async getOrCreateWallet(tx: Tx, customerId: string) {
    const existing = await tx.wallet.findUnique({ where: { customerId } });
    if (existing) return existing;
    return tx.wallet.create({ data: { customerId, balanceRs: 0 } });
  }

  async getBalance(prisma: Tx, customerId: string): Promise<number> {
    const wallet = await prisma.wallet.findUnique({ where: { customerId } });
    return wallet ? Number(wallet.balanceRs) : 0;
  }

  async credit(
    tx: Tx,
    params: { customerId: string; amountRs: number; type: 'REFUND' | 'ADMIN_ADJUSTMENT'; orderId?: string; refundId?: string; note?: string },
  ) {
    if (params.amountRs <= 0) throw new BadRequestException('Credit amount must be positive');

    const wallet = await this.getOrCreateWallet(tx, params.customerId);
    await tx.wallet.update({ where: { id: wallet.id }, data: { balanceRs: { increment: params.amountRs } } });
    return tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amountRs: params.amountRs,
        type: params.type,
        orderId: params.orderId,
        refundId: params.refundId,
        note: params.note,
      },
    });
  }

  /**
   * Used to pay for an order. Throws on insufficient balance rather
   * than allowing a wallet to go negative — a wallet is spendable
   * credit, not a line of credit or an overdraft. Balance past a
   * package's own expiresAt is treated as unusable (0), per the
   * finalized spec's own validity-window design — a wallet that's
   * never bought a package (expiresAt null) has no expiry to check
   * at all.
   */
  async debit(tx: Tx, params: { customerId: string; amountRs: number; type: 'ORDER_PAYMENT' | 'TIP' | 'ADMIN_ADJUSTMENT'; orderId?: string; note?: string }) {
    if (params.amountRs <= 0) throw new BadRequestException('Debit amount must be positive');

    const wallet = await tx.wallet.findUnique({ where: { customerId: params.customerId } });
    const isExpired = !!(wallet?.expiresAt && new Date(wallet.expiresAt) < new Date());
    const balance = wallet && !isExpired ? Number(wallet.balanceRs) : 0;
    if (balance < params.amountRs) {
      const shortfall = (params.amountRs - balance).toFixed(2);
      throw new BadRequestException(
        isExpired
          ? `Your wallet package has expired. ₹${params.amountRs.toFixed(2)} additional payment required.`
          : `Insufficient wallet balance. ₹${shortfall} additional payment required.`,
      );
    }

    await tx.wallet.update({ where: { id: wallet.id }, data: { balanceRs: { decrement: params.amountRs } } });
    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amountRs: -params.amountRs,
        type: params.type,
        orderId: params.orderId,
        note: params.note,
      },
    });
    // Balance before/after included specifically for callers building a
    // wallet-order receipt (see the finalized spec: the email needs to
    // show both) — avoids a second query right after this one for
    // something already known here.
    const balanceAfterRs = balance - params.amountRs;
    // Same "just crossed" detection as the low-stock alert — only true
    // the one debit that pushes the balance under the threshold, not
    // every debit afterward while it stays low, so this never fires a
    // fresh warning on every single order once a customer is already
    // running low.
    const rules = await this.businessRules.getRules();
    const crossedLowBalanceThreshold = balance >= rules.lowBalanceThresholdRs && balanceAfterRs < rules.lowBalanceThresholdRs;
    return { transaction, balanceBeforeRs: balance, balanceAfterRs, crossedLowBalanceThreshold };
  }

  async listTransactions(customerId: string, prisma: Tx) {
    const wallet = await prisma.wallet.findUnique({ where: { customerId } });
    if (!wallet) return [];
    return prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' } });
  }

  /** The customer-facing wallet screen — balance, active package, expiry, low-balance warning, today's activity, and a full transaction list in one call. */
  async getWalletOverview(customerId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { customerId } });
    const transactions = await this.listTransactions(customerId, this.prisma);
    const rules = await this.businessRules.getRules();
    const balanceRs = wallet ? Number(wallet.balanceRs) : 0;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todaysOrdersRs = transactions
      .filter((t: any) => t.type === 'ORDER_PAYMENT' && new Date(t.createdAt) >= startOfToday)
      .reduce((sum: number, t: any) => sum + Math.abs(Number(t.amountRs)), 0);

    return {
      balanceRs,
      activePackageName: wallet?.activePackageName ?? null,
      expiresAt: wallet?.expiresAt ?? null,
      // Computed live every time this is called, not a stored flag —
      // always reflects the real current balance, including going back
      // to false again the moment a top-up brings it back over the
      // threshold, with nothing to separately reset.
      isLowBalance: balanceRs < rules.lowBalanceThresholdRs,
      lowBalanceThresholdRs: rules.lowBalanceThresholdRs,
      // "Today's Remaining Balance" is just the current live balance —
      // it's the SAME number as balanceRs (a wallet has no separate
      // daily allowance to track against), shown again here under its
      // own label to match the finalized dashboard mockup directly.
      todaysOrdersRs,
      todaysRemainingBalanceRs: balanceRs,
      transactions,
    };
  }

  async listPackages() {
    return this.prisma.walletPackage.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  /**
   * Real money changing hands — a Razorpay Payment Link, same pattern
   * as the tip-via-UPI and cash-collection-via-UPI flows. The wallet
   * is only actually credited once Razorpay confirms payment (see
   * confirmPackagePurchase), never optimistically here.
   */
  async purchasePackage(customerId: string, packageId: string) {
    const pkg = await this.prisma.walletPackage.findUniqueOrThrow({ where: { id: packageId } });
    if (!pkg.isActive) throw new BadRequestException('This package is no longer available');

    // Charged together as one payment — the wallet credit and the
    // subscriber's own discounted package+delivery fee — but only
    // creditRs ever lands in the food wallet (see
    // confirmPackagePurchase). packageFeeRs funds delivery/packaging
    // for the whole subscription period and is never spendable on food.
    const totalChargeRs = Number(pkg.priceRs) + Number(pkg.packageFeeRs);

    const paymentLink = await this.razorpay.createPaymentLink({
      amountRs: totalChargeRs,
      referenceId: `wallet-package:${customerId}:${pkg.id}`,
      description: `Panda Wallet — ${pkg.name}`,
    });

    return { paymentLinkId: paymentLink.id, shortUrl: paymentLink.short_url };
  }

  /**
   * Called from the payments webhook once Razorpay confirms a wallet
   * package purchase was actually paid — parses the customer and
   * package back out of the reference_id purchasePackage encoded.
   * Buying a new package while one is still active simply adds this
   * package's credit on top of any remaining balance and resets the
   * expiry to a fresh window from now, rather than trying to merge or
   * stack two different validity windows.
   */
  async confirmPackagePurchase(customerId: string, packageId: string) {
    const pkg = await this.prisma.walletPackage.findUnique({ where: { id: packageId } });
    if (!pkg) return;

    return this.activateSubscription(customerId, {
      planName: pkg.name,
      priceRs: Number(pkg.priceRs),
      packageFeeRs: Number(pkg.packageFeeRs),
      creditRs: Number(pkg.creditRs),
      validityDays: pkg.validityDays,
      source: 'ONLINE',
    });
  }

  /**
   * Starts a subscription: credits the food wallet, sets the plan's
   * expiry, and writes the WalletSubscription record the statement is
   * built from. Deliberately adds to (never overwrites) the existing
   * balance, so anything left over from an earlier plan carries forward
   * into the new one. The plan runs through the END of its last day, so
   * a 7-day plan bought at 10 am on the 28th is valid all through the
   * 3rd, not cut off at 10 am on the 4th.
   */
  async activateSubscription(customerId: string, plan: SubscriptionPlanInput) {
    const now = new Date();
    const startKey = plan.startDate ?? shopDateKey(now);
    // Started today: the moment of purchase. Started on an earlier day
    // (recorded by staff): the very start of that day.
    const startedAt = plan.startDate && plan.startDate !== shopDateKey(now) ? new Date(`${plan.startDate}T00:00:00+05:30`) : now;
    const endsAt = new Date(new Date(`${startKey}T23:59:59.999+05:30`).getTime() + (plan.validityDays - 1) * DAY_MS);

    return this.prisma.$transaction(async (tx: any) => {
      const wallet = await this.getOrCreateWallet(tx, customerId);
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceRs: { increment: plan.creditRs }, expiresAt: endsAt, activePackageName: plan.planName },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amountRs: plan.creditRs,
          type: 'ADMIN_ADJUSTMENT',
          note: `Purchased ${plan.planName} package`,
        },
      });
      return tx.walletSubscription.create({
        data: {
          customerId,
          planName: plan.planName,
          priceRs: plan.priceRs,
          packageFeeRs: plan.packageFeeRs,
          creditRs: plan.creditRs,
          validityDays: plan.validityDays,
          startedAt,
          endsAt,
          source: plan.source,
          createdByUserId: plan.createdByUserId,
        },
      });
    });
  }

  /**
   * Staff registering a subscription at the shop counter after taking
   * payment in person. Can start from a catalog package and override any
   * field, or be fully custom (any name, amount, fee and number of days).
   */
  async registerCounterSubscription(
    customerId: string,
    input: { packageId?: string; planName?: string; priceRs?: number; packageFeeRs?: number; creditRs?: number; validityDays?: number; startDate?: string },
    createdByUserId?: string,
  ) {
    let base = { planName: '', priceRs: 0, packageFeeRs: 0, creditRs: 0, validityDays: 0 };
    if (input.packageId) {
      const pkg = await this.prisma.walletPackage.findUniqueOrThrow({ where: { id: input.packageId } });
      base = {
        planName: pkg.name,
        priceRs: Number(pkg.priceRs),
        packageFeeRs: Number(pkg.packageFeeRs),
        creditRs: Number(pkg.creditRs),
        validityDays: pkg.validityDays,
      };
    }

    const priceRs = input.priceRs !== undefined ? Number(input.priceRs) : base.priceRs;
    const plan: SubscriptionPlanInput = {
      planName: (input.planName ?? base.planName).trim(),
      priceRs,
      packageFeeRs: input.packageFeeRs !== undefined ? Number(input.packageFeeRs) : base.packageFeeRs,
      // A custom plan with no separate credit amount simply credits what was paid.
      creditRs: input.creditRs !== undefined ? Number(input.creditRs) : input.priceRs !== undefined ? priceRs : base.creditRs,
      validityDays: input.validityDays !== undefined ? Number(input.validityDays) : base.validityDays,
      source: 'COUNTER',
      createdByUserId,
      startDate: input.startDate || undefined,
    };

    if (!plan.planName) throw new BadRequestException('A plan name is required');
    if (!(plan.creditRs > 0)) throw new BadRequestException('Wallet credit must be more than zero');
    if (!(plan.priceRs > 0)) throw new BadRequestException('Price must be more than zero');
    if (plan.packageFeeRs < 0) throw new BadRequestException('Package/delivery fee cannot be negative');
    if (!Number.isInteger(plan.validityDays) || plan.validityDays < 1) {
      throw new BadRequestException('Days must be a whole number of at least 1');
    }

    if (plan.startDate) {
      if (!DATE_KEY.test(plan.startDate)) throw new BadRequestException('Start date must look like 2026-08-28');
      const todayKey = shopDateKey(new Date());
      if (plan.startDate > todayKey) throw new BadRequestException('The start date cannot be in the future');
      const lastDay = new Date(new Date(`${plan.startDate}T23:59:59.999+05:30`).getTime() + (plan.validityDays - 1) * DAY_MS);
      if (lastDay.getTime() < Date.now()) {
        throw new BadRequestException('A plan that started on that date would already be over. Pick a start date inside the plan\'s days.');
      }
    }

    return this.activateSubscription(customerId, plan);
  }

  /**
   * Staff correcting the customer's current plan: name, fee, price, days,
   * start date, or the wallet credit itself (any change in credit adjusts
   * the balance by the difference, and is recorded as a wallet entry).
   */
  async updateSubscription(
    customerId: string,
    patch: { planName?: string; priceRs?: number; packageFeeRs?: number; creditRs?: number; validityDays?: number; startDate?: string },
  ) {
    const sub: any = await this.prisma.walletSubscription.findFirst({ where: { customerId }, orderBy: { startedAt: 'desc' } });
    if (!sub) throw new NotFoundException('This customer has no subscription to edit');

    const planName = (patch.planName ?? sub.planName).trim();
    const priceRs = patch.priceRs !== undefined ? Number(patch.priceRs) : Number(sub.priceRs);
    const packageFeeRs = patch.packageFeeRs !== undefined ? Number(patch.packageFeeRs) : Number(sub.packageFeeRs);
    const creditRs = patch.creditRs !== undefined ? Number(patch.creditRs) : Number(sub.creditRs);
    const validityDays = patch.validityDays !== undefined ? Number(patch.validityDays) : sub.validityDays;

    if (!planName) throw new BadRequestException('A plan name is required');
    if (!(priceRs > 0) || !(creditRs > 0)) throw new BadRequestException('Price and wallet credit must be more than zero');
    if (packageFeeRs < 0) throw new BadRequestException('Package/delivery fee cannot be negative');
    if (!Number.isInteger(validityDays) || validityDays < 1) throw new BadRequestException('Days must be a whole number of at least 1');

    let startedAt: Date = new Date(sub.startedAt);
    if (patch.startDate) {
      if (!DATE_KEY.test(patch.startDate)) throw new BadRequestException('Start date must look like 2026-08-28');
      if (patch.startDate > shopDateKey(new Date())) throw new BadRequestException('The start date cannot be in the future');
      startedAt = new Date(`${patch.startDate}T00:00:00+05:30`);
    }
    const startKey = shopDateKey(startedAt);
    const endsAt = new Date(new Date(`${startKey}T23:59:59.999+05:30`).getTime() + (validityDays - 1) * DAY_MS);

    return this.prisma.$transaction(async (tx: any) => {
      const wallet = await tx.wallet.findUnique({ where: { customerId } });
      const creditDelta = creditRs - Number(sub.creditRs);
      if (wallet && creditDelta !== 0) {
        if (Number(wallet.balanceRs) + creditDelta < 0) {
          throw new BadRequestException('That credit is lower than what the customer has already spent');
        }
        await tx.wallet.update({ where: { id: wallet.id }, data: { balanceRs: { increment: creditDelta } } });
        await tx.walletTransaction.create({
          data: { walletId: wallet.id, amountRs: creditDelta, type: 'ADMIN_ADJUSTMENT', note: `Plan credit corrected by the shop (${Number(sub.creditRs)} to ${creditRs})` },
        });
      }
      if (wallet) {
        await tx.wallet.update({ where: { id: wallet.id }, data: { expiresAt: endsAt, activePackageName: planName } });
      }
      return tx.walletSubscription.update({
        where: { id: sub.id },
        data: { planName, priceRs, packageFeeRs, creditRs, validityDays, startedAt, endsAt },
      });
    });
  }

  private parseHistoryItems(items: unknown): { name: string; quantity: number; amountRs: number }[] {
    if (!Array.isArray(items) || items.length === 0) throw new BadRequestException('Add at least one item');
    return items.map((raw: any) => {
      const name = String(raw?.name ?? '').trim();
      const quantity = Number(raw?.quantity ?? 1);
      const amountRs = Number(raw?.amountRs);
      if (!name) throw new BadRequestException('Every item needs a name');
      if (!Number.isInteger(quantity) || quantity < 1) throw new BadRequestException('Quantity must be a whole number of at least 1');
      if (!(amountRs > 0)) throw new BadRequestException('Every item needs an amount above zero');
      return { name, quantity, amountRs };
    });
  }

  private assertDateInPlan(sub: any, date: string) {
    if (!DATE_KEY.test(date)) throw new BadRequestException('Date must look like 2026-08-28');
    const startKey = shopDateKey(new Date(sub.startedAt));
    const endKey = shopDateKey(new Date(sub.endsAt));
    const todayKey = shopDateKey(new Date());
    if (date < startKey || date > endKey) {
      throw new BadRequestException(`That date is outside the plan (${startKey} to ${endKey})`);
    }
    if (date > todayKey) throw new BadRequestException('A purchase cannot be dated in the future');
  }

  /**
   * Staff adding a past purchase by hand (for a customer who bought
   * before this system existed, or a bill never rung through the app).
   * It reduces the balance and counts toward spending exactly like a
   * real order, and appears in the statement marked as added by the shop.
   */
  async addHistoryEntry(customerId: string, input: { date: string; items: HistoryItemInput[]; note?: string }, createdByUserId?: string) {
    const sub: any = await this.prisma.walletSubscription.findFirst({ where: { customerId }, orderBy: { startedAt: 'desc' } });
    if (!sub) throw new BadRequestException('Start a plan for this customer first');
    this.assertDateInPlan(sub, input.date);
    const items = this.parseHistoryItems(input.items);
    const total = items.reduce((sum, i) => sum + i.amountRs, 0);

    return this.prisma.$transaction(async (tx: any) => {
      const wallet = await tx.wallet.findUnique({ where: { customerId } });
      if (!wallet || Number(wallet.balanceRs) < total) {
        throw new BadRequestException('That is more than the customer\'s available balance');
      }
      await tx.wallet.update({ where: { id: wallet.id }, data: { balanceRs: { decrement: total } } });
      await tx.walletTransaction.create({
        data: { walletId: wallet.id, amountRs: -total, type: 'ADMIN_ADJUSTMENT', note: `Past purchase added by the shop (${input.date})` },
      });
      return tx.walletHistoryEntry.create({
        data: {
          subscriptionId: sub.id,
          customerId,
          entryDate: new Date(`${input.date}T00:00:00.000Z`),
          items,
          amountRs: total,
          note: input.note?.trim() || null,
          createdByUserId,
        },
      });
    });
  }

  async updateHistoryEntry(entryId: string, patch: { date?: string; items?: HistoryItemInput[]; note?: string }) {
    const entry: any = await this.prisma.walletHistoryEntry.findUnique({ where: { id: entryId }, include: { subscription: true } });
    if (!entry) throw new NotFoundException('That entry was not found');

    const date = patch.date ?? entry.entryDate.toISOString().slice(0, 10);
    this.assertDateInPlan(entry.subscription, date);
    const items = patch.items !== undefined ? this.parseHistoryItems(patch.items) : (entry.items as HistoryItemInput[]);
    const total = items.reduce((sum, i) => sum + Number(i.amountRs), 0);
    const delta = total - Number(entry.amountRs);

    return this.prisma.$transaction(async (tx: any) => {
      const wallet = await tx.wallet.findUnique({ where: { customerId: entry.customerId } });
      if (delta !== 0) {
        if (!wallet || Number(wallet.balanceRs) - delta < 0) throw new BadRequestException('That is more than the customer\'s available balance');
        await tx.wallet.update({ where: { id: wallet.id }, data: { balanceRs: { decrement: delta } } });
        await tx.walletTransaction.create({
          data: { walletId: wallet.id, amountRs: -delta, type: 'ADMIN_ADJUSTMENT', note: `Past purchase edited by the shop (${date})` },
        });
      }
      return tx.walletHistoryEntry.update({
        where: { id: entryId },
        data: {
          entryDate: new Date(`${date}T00:00:00.000Z`),
          items,
          amountRs: total,
          note: patch.note !== undefined ? patch.note.trim() || null : entry.note,
        },
      });
    });
  }

  async deleteHistoryEntry(entryId: string) {
    const entry: any = await this.prisma.walletHistoryEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('That entry was not found');

    return this.prisma.$transaction(async (tx: any) => {
      const wallet = await tx.wallet.findUnique({ where: { customerId: entry.customerId } });
      if (wallet) {
        await tx.wallet.update({ where: { id: wallet.id }, data: { balanceRs: { increment: Number(entry.amountRs) } } });
        await tx.walletTransaction.create({
          data: { walletId: wallet.id, amountRs: Number(entry.amountRs), type: 'ADMIN_ADJUSTMENT', note: 'Past purchase removed by the shop' },
        });
      }
      await tx.walletHistoryEntry.delete({ where: { id: entryId } });
      return { deleted: true };
    });
  }

  /**
   * Everything a customer (or the admin looking at that customer) needs
   * to see about their current plan: what they paid, how many days have
   * passed, what they bought each day, what was spent, and what's left.
   * Days with no purchase simply don't appear in the day log (and show
   * as zero on the chart) — nothing is charged or billed for them.
   */
  async getSubscriptionStatement(customerId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { customerId } });
    const balanceRs = wallet ? Number(wallet.balanceRs) : 0;
    const sub = await this.prisma.walletSubscription.findFirst({ where: { customerId }, orderBy: { startedAt: 'desc' } });
    if (!sub) return { hasSubscription: false, balanceRs };

    const debits: any[] = wallet
      ? await this.prisma.walletTransaction.findMany({
          where: { walletId: wallet.id, type: 'ORDER_PAYMENT', createdAt: { gte: sub.startedAt } },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const orderIds = debits.map((t: any) => t.orderId).filter((id: string | null): id is string => !!id);
    const orders: any[] = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          include: { items: { include: { product: { select: { name: true } } } } },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const amountByOrder = new Map<string, number>(debits.map((t: any) => [t.orderId as string, Math.abs(Number(t.amountRs))]));

    const startKey = shopDateKey(new Date(sub.startedAt));
    const dayMap = new Map<string, any>();
    for (const o of orders) {
      const key = shopDateKey(new Date(o.createdAt));
      const entry = dayMap.get(key) ?? { date: key, dayNumber: dayNumberOf(startKey, key), weekday: weekdayOf(key), orders: [], totalRs: 0 };
      const amountRs = amountByOrder.get(o.id) ?? Number(o.totalRs);
      entry.orders.push({
        orderNumber: o.orderNumber,
        time: new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: SHOP_TZ }),
        amountRs,
        items: o.items.map((i: any) => ({ name: i.product.name, quantity: i.quantity, amountRs: Number(i.lineTotalRs) })),
      });
      entry.totalRs += amountRs;
      dayMap.set(key, entry);
    }
    // Purchases the shop typed in by hand for this plan.
    const manualEntries: any[] = (await this.prisma.walletHistoryEntry?.findMany({ where: { subscriptionId: sub.id }, orderBy: { entryDate: 'asc' } })) ?? [];
    for (const e of manualEntries) {
      const key = new Date(e.entryDate).toISOString().slice(0, 10);
      const entry = dayMap.get(key) ?? { date: key, dayNumber: dayNumberOf(startKey, key), weekday: weekdayOf(key), orders: [], totalRs: 0 };
      const amountRs = Number(e.amountRs);
      entry.orders.push({
        orderNumber: 'Added by shop',
        time: '',
        amountRs,
        manual: true,
        entryId: e.id,
        note: e.note ?? null,
        items: (e.items as any[]).map((i: any) => ({ name: i.name, quantity: i.quantity, amountRs: Number(i.amountRs) })),
      });
      entry.totalRs += amountRs;
      dayMap.set(key, entry);
    }

    const dayLog = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const spentRs = dayLog.reduce((sum: number, d: any) => sum + d.totalRs, 0);

    const daysTotal = sub.validityDays;
    const daysElapsed = Math.min(Math.max(dayNumberOf(startKey, shopDateKey(new Date())), 0), daysTotal);
    const chart = Array.from({ length: daysTotal }, (_, i) => {
      const date = addDaysToKey(startKey, i);
      return { dayNumber: i + 1, date, spentRs: dayMap.get(date)?.totalRs ?? 0, isFuture: i + 1 > daysElapsed };
    });

    return {
      hasSubscription: true,
      subscription: {
        id: sub.id,
        planName: sub.planName,
        priceRs: Number(sub.priceRs),
        packageFeeRs: Number(sub.packageFeeRs),
        totalPaidRs: Number(sub.priceRs) + Number(sub.packageFeeRs),
        creditRs: Number(sub.creditRs),
        validityDays: sub.validityDays,
        startedAt: sub.startedAt,
        endsAt: sub.endsAt,
        source: sub.source,
        status: new Date() > new Date(sub.endsAt) ? 'EXPIRED' : 'ACTIVE',
      },
      daysTotal,
      daysElapsed,
      daysRemaining: Math.max(daysTotal - daysElapsed, 0),
      daysWithOrders: dayLog.length,
      spentRs,
      balanceRs,
      chart,
      dayLog,
    };
  }

  /** Every customer's current plan with days used, spend and balance — the admin's tracking table. */
  async listSubscribers() {
    const subs: any[] = await this.prisma.walletSubscription.findMany({
      orderBy: { startedAt: 'desc' },
      include: { customer: { include: { user: true, wallet: true } } },
    });

    const latestByCustomer = new Map<string, any>();
    for (const s of subs) if (!latestByCustomer.has(s.customerId)) latestByCustomer.set(s.customerId, s);
    const latest = [...latestByCustomer.values()];

    const walletIds = latest.map((s: any) => s.customer.wallet?.id).filter((id: string | undefined): id is string => !!id);
    const debits: any[] = walletIds.length
      ? await this.prisma.walletTransaction.findMany({ where: { walletId: { in: walletIds }, type: 'ORDER_PAYMENT' } })
      : [];

    const manualEntries: any[] =
      (await this.prisma.walletHistoryEntry?.findMany({ where: { subscriptionId: { in: latest.map((s: any) => s.id) } } })) ?? [];

    const todayKey = shopDateKey(new Date());
    return latest.map((s: any) => {
      const walletId = s.customer.wallet?.id;
      const spentRs =
        debits
          .filter((t: any) => t.walletId === walletId && new Date(t.createdAt) >= new Date(s.startedAt))
          .reduce((sum: number, t: any) => sum + Math.abs(Number(t.amountRs)), 0) +
        manualEntries.filter((e: any) => e.subscriptionId === s.id).reduce((sum: number, e: any) => sum + Number(e.amountRs), 0);
      const daysTotal = s.validityDays;
      const daysElapsed = Math.min(Math.max(dayNumberOf(shopDateKey(new Date(s.startedAt)), todayKey), 0), daysTotal);
      return {
        customerId: s.customerId,
        customerName: s.customer.name,
        phone: s.customer.user?.phone ?? null,
        email: s.customer.user?.email ?? null,
        planName: s.planName,
        totalPaidRs: Number(s.priceRs) + Number(s.packageFeeRs),
        startedAt: s.startedAt,
        endsAt: s.endsAt,
        daysTotal,
        daysElapsed,
        daysRemaining: Math.max(daysTotal - daysElapsed, 0),
        spentRs,
        balanceRs: s.customer.wallet ? Number(s.customer.wallet.balanceRs) : 0,
        status: new Date() > new Date(s.endsAt) ? 'EXPIRED' : 'ACTIVE',
      };
    });
  }

  /**
   * One invoice email per customer per day covering everything they
   * ordered that day, showing the shop's logo and name, which day of the
   * plan it was, and the balance left. A customer who didn't order that
   * day gets nothing — no order, no invoice, no charge. Run nightly by
   * WalletCronService.
   */
  async sendDailyInvoices(now: Date = new Date()) {
    const { key: dateKey, start: startOfDay, end: endOfDay, billDate } = shopDayRange(now);

    const todaysDebits = await this.prisma.walletTransaction.findMany({
      where: { type: 'ORDER_PAYMENT', createdAt: { gte: startOfDay, lte: endOfDay } },
      include: { wallet: { include: { customer: { include: { user: true } } } } },
      orderBy: { createdAt: 'asc' },
    });

    const byWalletId = new Map<string, typeof todaysDebits>();
    for (const tx of todaysDebits) {
      if (!byWalletId.has(tx.walletId)) byWalletId.set(tx.walletId, []);
      byWalletId.get(tx.walletId)!.push(tx);
    }
    if (byWalletId.size === 0) return { invoicesSent: 0 };

    const shop: any = await this.prisma.shopSettings?.findUnique({ where: { id: 'default' } });
    const businessName: string = shop?.businessName ?? 'Protein Panda';
    const logoUrl: string | null = shop?.logoUrl ?? null;
    const prettyDate = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

    let sent = 0;
    for (const [, transactions] of byWalletId) {
      const wallet = transactions[0].wallet;
      const email = wallet.customer.user.email;
      if (!email) continue;

      const closingBalanceRs = Number(wallet.balanceRs);
      const todaysTotalRs = transactions.reduce((sum: number, t: { amountRs: unknown }) => sum + Math.abs(Number(t.amountRs)), 0);
      const openingBalanceRs = closingBalanceRs + todaysTotalRs;

      const orderIds = transactions.map((t: { orderId: string | null }) => t.orderId).filter((id: string | null): id is string => !!id);
      const orders = await this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: 'asc' },
      });

      const sub: any = await this.prisma.walletSubscription?.findFirst({
        where: { customerId: wallet.customerId, startedAt: { lte: endOfDay } },
        orderBy: { startedAt: 'desc' },
      });
      let dayLine = '';
      let planLine = wallet.activePackageName ?? 'N/A';
      if (sub) {
        const startKey = shopDateKey(new Date(sub.startedAt));
        const dayNo = Math.min(Math.max(dayNumberOf(startKey, dateKey), 1), sub.validityDays);
        const remaining = Math.max(sub.validityDays - dayNo, 0);
        planLine = `${sub.planName} — ₹${Number(sub.priceRs).toFixed(0)} + ₹${Number(sub.packageFeeRs).toFixed(0)} = ₹${(Number(sub.priceRs) + Number(sub.packageFeeRs)).toFixed(0)}`;
        dayLine = `<p><strong>Day ${dayNo} of ${sub.validityDays}</strong> · ${remaining} day${remaining === 1 ? '' : 's'} remaining · valid until ${new Date(sub.endsAt).toLocaleDateString('en-IN', { timeZone: SHOP_TZ })}</p>`;
      }

      const rowsHtml = orders
        .flatMap((o: any) =>
          o.items.map(
            (i: any) =>
              `<tr><td>${escapeHtml(o.orderNumber)}</td><td>${new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: SHOP_TZ })}</td><td>${escapeHtml(i.product.name)}</td><td>${i.quantity}</td><td>₹${(Number(i.unitPriceRs) * i.quantity).toFixed(2)}</td></tr>`,
          ),
        )
        .join('');

      await this.email.send({
        to: email,
        subject: `${businessName} — Daily Wallet Invoice (${prettyDate})`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto">
            ${logoUrl ? `<p style="text-align:center"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName)}" style="max-height:70px" /></p>` : ''}
            <h2 style="text-align:center;margin:0">${escapeHtml(businessName)}</h2>
            <p style="text-align:center;margin:4px 0 16px">Daily Invoice</p>
            <p>Customer: ${escapeHtml(wallet.customer.name)}</p>
            <p>Plan: ${escapeHtml(planLine)}</p>
            <p>Date: ${prettyDate}</p>
            ${dayLine}
            <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
              <tr><th>Order</th><th>Time</th><th>Item</th><th>Qty</th><th>Amount</th></tr>
              ${rowsHtml}
            </table>
            <p><strong>Today's Total: ₹${todaysTotalRs.toFixed(2)}</strong></p>
            <p>Opening Wallet: ₹${openingBalanceRs.toFixed(2)}</p>
            <p>Today's Deduction: ₹${todaysTotalRs.toFixed(2)}</p>
            <p style="font-size:18px"><strong>Available Balance: ₹${closingBalanceRs.toFixed(2)}</strong></p>
          </div>
        `,
      });

      await this.prisma.dailyBillingRecord.upsert({
        where: { customerId_billDate: { customerId: wallet.customerId, billDate } },
        create: {
          customerId: wallet.customerId,
          billDate,
          orderCount: orders.length,
          todaysTotalRs,
          openingBalanceRs,
          closingBalanceRs,
          emailSent: true,
        },
        update: {
          orderCount: orders.length,
          todaysTotalRs,
          openingBalanceRs,
          closingBalanceRs,
          emailSent: true,
        },
      });

      sent++;
    }

    return { invoicesSent: sent };
  }
}
