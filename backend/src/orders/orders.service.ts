import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OrderChannel, FulfillmentType, PointsSourceType, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { PointsService } from '../points/points.service';
import { StreaksService } from '../streaks/streaks.service';
import { AttendanceService } from '../streaks/attendance.service';
import { BusinessRulesService } from '../common/business-rules.service';
import { InvoiceService } from '../billing/invoice.service';
import { EmailService } from '../notifications/email.service';
import { OrdersGateway } from '../common/orders.gateway';
import { AchievementsService } from '../achievements/achievements.service';
import { ShopService } from '../shop/shop.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import { WalletService } from '../customers/wallet.service';

interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  addonIds?: string[];
  specialInstructions?: string;
}

interface CreateOrderInput {
  customerId: string;
  channel: OrderChannel;
  fulfillmentType: FulfillmentType;
  items: CreateOrderItemInput[];
  couponCode?: string;
  redemptionId?: string;
  manualDiscountRs?: number;
  manualDiscountReason?: string;
  extraChargeRs?: number;
  paymentMethod: PaymentMethod;
  markPaidImmediately?: boolean;
  processedByUserId?: string;
  deliveryAddress?: string;
  deliveryContactPhone?: string;
  deliveryInstructions?: string;
  deliveryPincode?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  idempotencyKey?: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private streaks: StreaksService,
    private attendance: AttendanceService,
    private gateway: OrdersGateway,
    private achievements: AchievementsService,
    private shop: ShopService,
    private notificationQueue: NotificationQueueService,
    private inventory: InventoryService,
    private notificationCenter: NotificationCenterService,
    private wallet: WalletService,
    private businessRules: BusinessRulesService,
    private invoices: InvoiceService,
    private email: EmailService,
  ) {}

  async create(input: CreateOrderInput) {
    if (!input.items.length) throw new BadRequestException('Order must contain at least one item');

    const shopOpen = await this.shop.isOpen();
    if (!shopOpen) {
      throw new BadRequestException('We are currently closed. Please try again when we reopen.');
    }

    if (input.fulfillmentType === 'DELIVERY' && (!input.deliveryAddress || !input.deliveryContactPhone)) {
      throw new BadRequestException('A delivery address and contact phone are required for delivery orders');
    }

    if (input.fulfillmentType === 'DELIVERY' && input.deliveryPincode) {
      const serviceable = await this.shop.isPincodeServiceable(input.deliveryPincode);
      if (!serviceable) {
        throw new BadRequestException(`Sorry, we don't currently deliver to pincode ${input.deliveryPincode}. Try pickup instead?`);
      }
    }

    if (input.idempotencyKey) {
      const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }

    try {
      return await this.createOrderTransaction(input);
    } catch (err) {
      if (input.idempotencyKey && this.isUniqueConstraintViolation(err, 'idempotencyKey')) {
        const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) return existing;
      }
      throw err;
    }
  }

  private isUniqueConstraintViolation(err: unknown, field: string): boolean {
    const prismaErr = err as { code?: string; meta?: { target?: string[] } };
    return prismaErr?.code === 'P2002' && !!prismaErr.meta?.target?.includes(field);
  }

  private async createOrderTransaction(input: CreateOrderInput) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: input.customerId },
        include: { allergies: { include: { allergen: true } } },
      });
      const allergenNames = new Set(customer.allergies.map((a: any) => a.allergen.name));

      let subtotalRs = 0;
      let totalProteinG = 0;
      let totalCalories = 0;
      const itemsData: any[] = [];

      for (const item of input.items) {
        const product = await tx.product.findUniqueOrThrow({
          where: { id: item.productId },
          include: { nutrition: true, allergens: { include: { allergen: true } }, addonOptions: true },
        });

        if (!product.isActive) throw new BadRequestException(`${product.name} is unavailable`);

        const productAllergens = product.allergens.map((a: any) => a.allergen.name);
        const conflict = productAllergens.find((name: string) => allergenNames.has(name));
        if (conflict) {
          throw new BadRequestException(`${product.name} contains ${conflict}, which is in your allergy list`);
        }

        const chosenAddons = product.addonOptions.filter((a: any) => item.addonIds?.includes(a.id));

        const requiredGroups: string[] = Array.from(
          new Set<string>(product.addonOptions.filter((a: any) => a.isRequired).map((a: any) => String(a.group))),
        );
        for (const group of requiredGroups) {
          const picksInGroup = chosenAddons.filter((a: any) => a.group === group);
          if (picksInGroup.length !== 1) {
            throw new BadRequestException(
              `${product.name}: choose exactly one ${group.toLowerCase()} option`,
            );
          }
        }

        const addonPriceRs = chosenAddons.reduce((sum: number, a: any) => sum + Number(a.extraPriceRs), 0);
        const addonProteinG = chosenAddons.reduce((sum: number, a: any) => sum + Number(a.extraProteinG ?? 0), 0);
        const addonCalories = chosenAddons.reduce((sum: number, a: any) => sum + (a.extraCalories ?? 0), 0);

        const unitPriceRs = Number(product.basePriceRs) + addonPriceRs;
        const lineTotalRs = unitPriceRs * item.quantity;
        const lineProteinG = (Number(product.nutrition?.proteinG ?? 0) + addonProteinG) * item.quantity;
        const lineCalories = ((product.nutrition?.calories ?? 0) + addonCalories) * item.quantity;

        subtotalRs += lineTotalRs;
        totalProteinG += lineProteinG;
        totalCalories += lineCalories;

        itemsData.push({
          productId: product.id,
          quantity: item.quantity,
          unitPriceRs,
          lineTotalRs,
          proteinG: lineProteinG,
          calories: lineCalories,
          specialInstructions: item.specialInstructions?.trim().slice(0, 200) || undefined,
          addons: { create: chosenAddons.map((a: any) => ({ addonId: a.id, priceRs: a.extraPriceRs })) },
        });
      }

      let discountRs = 0;
      let couponId: string | undefined;
      if (input.couponCode) {
        const coupon = await tx.coupon.findUnique({ where: { code: input.couponCode } });
        if (!coupon) throw new BadRequestException('Invalid coupon code');
        if (!coupon.isActive) throw new BadRequestException('This coupon is no longer active');
        const now = new Date();
        if (now < coupon.validFrom || now > coupon.validUntil) {
          throw new BadRequestException('This coupon has expired or is not yet valid');
        }
        if (coupon.usageLimit !== null && coupon.timesUsed >= coupon.usageLimit) {
          throw new BadRequestException('This coupon has reached its usage limit');
        }
        if (coupon.minOrderRs !== null && subtotalRs < Number(coupon.minOrderRs)) {
          throw new BadRequestException(`This coupon needs a minimum order of ₹${coupon.minOrderRs}`);
        }
        if (coupon.firstOrderOnly) {
          const priorOrderCount = await tx.order.count({ where: { customerId: input.customerId } });
          if (priorOrderCount > 0) {
            throw new BadRequestException('This coupon is only valid on your first order');
          }
        }
        if (coupon.maxUsesPerCustomer !== null) {
          const usedByThisCustomer = await tx.order.count({ where: { customerId: input.customerId, couponId: coupon.id } });
          if (usedByThisCustomer >= coupon.maxUsesPerCustomer) {
            throw new BadRequestException('You have already used this coupon the maximum number of times');
          }
        }

        discountRs = coupon.discountRs
          ? Number(coupon.discountRs)
          : subtotalRs * (Number(coupon.discountPct ?? 0) / 100);
        couponId = coupon.id;
        await tx.coupon.update({ where: { id: coupon.id }, data: { timesUsed: { increment: 1 } } });
      }

      let appliedRedemption: { id: string } | null = null;
      if (input.redemptionId) {
        const redemption = await tx.rewardRedemption.findUniqueOrThrow({
          where: { id: input.redemptionId },
          include: { reward: true },
        });
        if (redemption.customerId !== input.customerId) {
          throw new ForbiddenException('This reward redemption does not belong to this customer');
        }
        if (redemption.usedAt) {
          throw new BadRequestException('This reward has already been used on another order');
        }
        if (redemption.reward.type !== 'DISCOUNT' || !redemption.reward.valueRs) {
          throw new BadRequestException('Only discount-type rewards can be applied to an order directly — this one needs to be handled manually');
        }
        discountRs += Number(redemption.reward.valueRs);
        appliedRedemption = { id: redemption.id };
      }

      if (input.manualDiscountRs !== undefined) {
        if (input.manualDiscountRs < 0) {
          throw new BadRequestException('Manual discount cannot be negative');
        }
        if (input.manualDiscountRs > subtotalRs) {
          throw new BadRequestException('Manual discount cannot exceed the order subtotal');
        }
        discountRs += input.manualDiscountRs;
      }

      const totalRs = Math.max(subtotalRs - discountRs, 0);

      let deliveryFeeRs = 0;
      if (input.fulfillmentType === 'DELIVERY' && input.deliveryLat != null && input.deliveryLng != null) {
        const quote = await this.shop.quoteDeliveryFee(input.deliveryLat, input.deliveryLng);
        if (quote) deliveryFeeRs = quote.feeRs;
      }
      const challengeFeeRs = input.extraChargeRs ?? 0;
      if (challengeFeeRs < 0) throw new BadRequestException('Challenge fee cannot be negative');

      // Packaging surcharge for takeaway/pickup only — never DINE_IN
      // (no packaging involved) or DELIVERY (already has its own fee).
      // 0 if the admin has disabled it in Business Rules.
      const rulesForFees = await this.businessRules.getRules();
      const takeawayFeeRs = input.fulfillmentType === 'PICKUP' && rulesForFees.takeawayFeeEnabled ? rulesForFees.takeawayFeeRs : 0;

      const grandTotalRs = totalRs + deliveryFeeRs + challengeFeeRs + takeawayFeeRs;

      const order = await tx.order.create({
        data: {
          orderNumber: `PENDING-${input.idempotencyKey ?? randomUUID()}`,
          idempotencyKey: input.idempotencyKey,
          customerId: input.customerId,
          channel: input.channel,
          fulfillmentType: input.fulfillmentType,
          subtotalRs,
          discountRs,
          discountReason: input.manualDiscountRs ? input.manualDiscountReason : undefined,
          totalRs,
          deliveryFeeRs,
          challengeFeeRs,
          takeawayFeeRs,
          totalProteinG,
          totalCalories,
          couponId,
          processedByUserId: input.processedByUserId,
          items: { create: itemsData },
          payment: {
            create: {
              method: input.paymentMethod,
              status: input.markPaidImmediately || input.paymentMethod === 'WALLET' ? 'PAID' : 'PENDING',
              amountRs: grandTotalRs,
              paidAt: input.markPaidImmediately || input.paymentMethod === 'WALLET' ? new Date() : undefined,
            },
          },
        },
        include: { items: true, payment: true },
      });

      let walletDebitInfo: { balanceBeforeRs: number; balanceAfterRs: number; crossedLowBalanceThreshold: boolean } | null = null;
      if (input.paymentMethod === 'WALLET') {
        const debitResult = await this.wallet.debit(tx, {
          customerId: input.customerId,
          amountRs: grandTotalRs,
          type: 'ORDER_PAYMENT',
          orderId: order.id,
          note: `Order #${order.orderNumber.startsWith('PENDING-') ? '(pending)' : order.orderNumber}`,
        });
        walletDebitInfo = {
          balanceBeforeRs: debitResult.balanceBeforeRs,
          balanceAfterRs: debitResult.balanceAfterRs,
          crossedLowBalanceThreshold: debitResult.crossedLowBalanceThreshold,
        };
      }

      const orderNumber = `PP${String(order.sequenceNumber).padStart(4, '0')}`;
      await tx.order.update({ where: { id: order.id }, data: { orderNumber } });
      order.orderNumber = orderNumber;

      if (appliedRedemption) {
        await tx.rewardRedemption.update({
          where: { id: appliedRedemption.id },
          data: { usedAt: new Date(), orderId: order.id },
        });
      }

      if (input.fulfillmentType === 'DELIVERY') {
        await tx.deliveryOrder.create({
          data: {
            orderId: order.id,
            address: input.deliveryAddress,
            deliveryLat: input.deliveryLat,
            deliveryLng: input.deliveryLng,
            contactPhone: input.deliveryContactPhone!,
            deliveryInstructions: input.deliveryInstructions,
            deliveryOtp: String(Math.floor(1000 + Math.random() * 9000)),
          },
        });
        await tx.customer.update({
          where: { id: input.customerId },
          data: { address: input.deliveryAddress },
        });
      }

      await tx.nutritionLog.create({
        data: {
          customerId: input.customerId,
          orderId: order.id,
          proteinG: totalProteinG,
          calories: totalCalories,
          carbsG: 0,
          fatG: 0,
          fibreG: 0,
        },
      });

      const lowStockAlerts = await this.inventory.deductForOrder(
        tx,
        input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      );

      if (input.markPaidImmediately) {
        await this.grantOrderRewards(tx, order.id, input.customerId, totalProteinG, totalRs);
      }

      return { order, lowStockAlerts, walletDebitInfo };
    }).then(({ order, lowStockAlerts, walletDebitInfo }) => {
      this.gateway.emitOrderStatusUpdate({
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        customerId: input.customerId,
      });

      if (input.paymentMethod === 'CASH' || input.markPaidImmediately) {
        this.notificationQueue.queueInvoiceEmail(order.id).catch(() => undefined);
      }

      if (process.env.WHATSAPP_AUTH_KEY && process.env.WHATSAPP_TEMPLATE_ORDER_CONFIRMED) {
        this.prisma.customer
          .findUnique({ where: { id: input.customerId }, include: { user: true } })
          .then((customer: { user: { phone: string | null } } | null) => {
            const phone = customer?.user?.phone;
            if (!phone) return;
            this.notificationQueue
              .queueWhatsAppNotification(phone, process.env.WHATSAPP_TEMPLATE_ORDER_CONFIRMED!, [
                order.orderNumber,
                `Rs ${order.totalRs}`,
              ])
              .catch(() => undefined);
          })
          .catch(() => undefined);
      }

      if (process.env.WHATSAPP_AUTH_KEY && process.env.WHATSAPP_TEMPLATE_INVOICE_SHARED && process.env.APP_PUBLIC_URL) {
        this.prisma.customer
          .findUnique({ where: { id: input.customerId }, include: { user: true } })
          .then((customer: { user: { phone: string | null } } | null) => {
            const phone = customer?.user?.phone;
            if (!phone) return;
            const token = this.invoices.generateInvoiceAccessToken(order.id);
            const invoiceUrl = `${process.env.APP_PUBLIC_URL}/orders/${order.id}/invoice-public?token=${token}`;
            this.notificationQueue
              .queueWhatsAppNotification(phone, process.env.WHATSAPP_TEMPLATE_INVOICE_SHARED!, [order.orderNumber, invoiceUrl])
              .catch(() => undefined);
          })
          .catch(() => undefined);
      }

      this.notificationCenter
        .notifyCustomer(input.customerId, 'ORDER_UPDATE', 'Order Confirmed', `Your order #${order.orderNumber} has been confirmed.`)
        .catch(() => undefined);

      if (lowStockAlerts.length > 0 && process.env.LOW_STOCK_ALERT_EMAIL) {
        const itemLines = lowStockAlerts
          .map((a: { ingredientName: string; quantityOnHand: number; reorderLevel: number }) =>
            `<li>${a.ingredientName}: ${a.quantityOnHand} remaining (reorder level: ${a.reorderLevel})</li>`,
          )
          .join('');
        this.email
          .send({
            to: process.env.LOW_STOCK_ALERT_EMAIL,
            subject: `⚠️ Low stock alert — ${lowStockAlerts.length} item${lowStockAlerts.length > 1 ? 's' : ''}`,
            html: `<p>The following ingredient${lowStockAlerts.length > 1 ? 's have' : ' has'} just dropped to or below its reorder level:</p><ul>${itemLines}</ul>`,
          })
          .catch(() => undefined);
      }

      // Panda Wallet order receipt — a dedicated email, distinct from
      // the generic invoice, specifically because a wallet order's
      // customer cares about something a normal invoice doesn't show
      // at all: what their balance was before/after, and how much
      // longer their package stays valid.
      if (walletDebitInfo) {
        this.prisma.customer
          .findUnique({ where: { id: input.customerId }, include: { user: true } })
          .then(async (customer: { name: string; user: { email: string | null } } | null) => {
            if (!customer?.user?.email) return;
            const wallet = await this.prisma.wallet.findUnique({ where: { customerId: input.customerId } });
            const itemLines = order.items
              .map((i: { quantity: number; unitPriceRs: unknown }) => `<li>${i.quantity} x item — ₹${(Number(i.unitPriceRs) * i.quantity).toFixed(2)}</li>`)
              .join('');
            await this.email.send({
              to: customer.user.email,
              subject: `Protein Panda — Wallet Order #${order.orderNumber}`,
              html: `
                <h2>Protein Panda</h2>
                <p>Invoice: ${order.orderNumber} — ${new Date().toLocaleString('en-IN')}</p>
                <ul>${itemLines}</ul>
                <p>Total order amount: ₹${order.totalRs}</p>
                <p>Wallet balance before order: ₹${walletDebitInfo.balanceBeforeRs.toFixed(2)}</p>
                <p>Amount deducted: ₹${(walletDebitInfo.balanceBeforeRs - walletDebitInfo.balanceAfterRs).toFixed(2)}</p>
                <p>Remaining wallet balance: ₹${walletDebitInfo.balanceAfterRs.toFixed(2)}</p>
                <p>Payment method: Wallet</p>
                ${wallet?.activePackageName ? `<p>Package: ${wallet.activePackageName}</p>` : ''}
                ${wallet?.expiresAt ? `<p>Wallet expiry date: ${new Date(wallet.expiresAt).toLocaleDateString('en-IN')}</p>` : ''}
              `,
            });
          })
          .catch(() => undefined);
      }

      // Low-balance warning — deliberately never blocks the order that
      // crosses the threshold; it's informational only, sent once at
      // the exact moment the balance first drops under it.
      if (walletDebitInfo?.crossedLowBalanceThreshold) {
        this.prisma.customer
          .findUnique({ where: { id: input.customerId }, include: { user: true } })
          .then((customer: { user: { email: string | null } } | null) => {
            if (!customer?.user?.email) return;
            this.email
              .send({
                to: customer.user.email,
                subject: `🐼 Your Panda Wallet balance is running low`,
                html: `<p>Your Panda Wallet balance is now ₹${walletDebitInfo!.balanceAfterRs.toFixed(2)}.</p><p>Top up on the Panda Wallet page to keep ordering without interruption.</p>`,
              })
              .catch(() => undefined);
          })
          .catch(() => undefined);
      }

      return order;
    });
  }

  async grantOrderRewards(tx: any, orderId: string, customerId: string, totalProteinG: number, totalRs: number) {
    const rules = await this.businessRules.getRules();
    const earnedPoints = this.businessRules.calculateLoyaltyPoints(totalRs, rules);
    if (earnedPoints > 0) {
      await this.points.award(tx, {
        customerId,
        points: earnedPoints,
        sourceType: PointsSourceType.PURCHASE,
        orderId,
      });
    }

    const streak = await this.streaks.recordQualifyingActivity(tx, customerId);
    await this.attendance.recordVisit(tx, customerId, orderId);

    const activeGoal = await tx.proteinGoalRun.findFirst({
      where: { customerId, completedAt: null },
    });
    if (activeGoal) {
      const newProgress = Number(activeGoal.progressG) + totalProteinG;
      const completed = newProgress >= Number(activeGoal.targetProteinG);
      await tx.proteinGoalRun.update({
        where: { id: activeGoal.id },
        data: {
          progressG: newProgress,
          ...(completed ? { completedAt: new Date() } : {}),
        },
      });
      if (completed) {
        await this.points.award(tx, {
          customerId,
          points: 500,
          sourceType: PointsSourceType.GOAL_ACHIEVEMENT,
          orderId,
          note: `Completed ${activeGoal.targetProteinG}g protein goal`,
        });
      }
    }

    await this.achievements.checkOrderAchievements(tx, customerId);
    await this.achievements.checkStreakAchievements(tx, customerId, streak.currentStreakDays);

    const customerForReferral = await tx.customer.findUnique({ where: { id: customerId } });
    if (customerForReferral?.referredByCode) {
      const orderCount = await tx.order.count({ where: { customerId } });
      if (orderCount === 1) {
        const referrer = await tx.customer.findUnique({ where: { referralCode: customerForReferral.referredByCode } });
        if (referrer) {
          await this.points.award(tx, { customerId, points: 50, sourceType: 'REFERRAL', note: 'Welcome bonus — signed up via a referral' });
          await this.points.award(tx, { customerId: referrer.id, points: 100, sourceType: 'REFERRAL', note: `Referral bonus — ${customerForReferral.name} placed their first order` });
        }
      }
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayLogs = await tx.nutritionLog.findMany({ where: { customerId, loggedAt: { gte: startOfToday } } });
    const todayProteinG = todayLogs.reduce((sum: number, l: { proteinG: unknown }) => sum + Number(l.proteinG), 0);
    await this.achievements.checkDailyProteinAchievement(tx, customerId, todayProteinG);
  }

  async findByCustomer(customerId: string, take = 20, cursor?: string) {
    return this.prisma.order.findMany({
      where: { customerId },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: true, addons: { include: { addon: true } } } }, payment: true },
    });
  }

  async findOneForCustomer(customerId: string, orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { include: { product: true, addons: true } },
        deliveryOrder: {
          select: {
            id: true,
            lastLat: true,
            lastLng: true,
            lastLocationAt: true,
            address: true,
            deliveryLat: true,
            deliveryLng: true,
            rating: true,
            tipAmountRs: true,
            deliveryPersonId: true,
            deliveryPerson: { select: { name: true } },
            deliveryOtp: true,
            failureReason: true,
            failureNote: true,
          },
        },
      },
    });
    if (order.customerId !== customerId) {
      throw new ForbiddenException('This order does not belong to you');
    }

    let riderStats: { avgRating: number | null; totalDeliveries: number } | null = null;
    if (order.deliveryOrder?.deliveryPersonId) {
      const deliveryPersonId = order.deliveryOrder.deliveryPersonId;
      const [ratingAgg, totalDeliveries] = await Promise.all([
        this.prisma.deliveryRating.aggregate({
          where: { deliveryOrder: { deliveryPersonId } },
          _avg: { rating: true },
        }),
        this.prisma.deliveryOrder.count({ where: { deliveryPersonId, order: { status: 'DELIVERED' } } }),
      ]);
      riderStats = { avgRating: ratingAgg._avg.rating, totalDeliveries };
    }

    return { ...order, riderStats };
  }

  async rateDelivery(customerId: string, orderId: string, rating: number, tags: string[], comment?: string) {
    if (rating < 1 || rating > 5) throw new BadRequestException('Rating must be between 1 and 5');

    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { deliveryOrder: true },
    });
    if (order.customerId !== customerId) throw new ForbiddenException('This order does not belong to you');
    if (!order.deliveryOrder) throw new BadRequestException('This order has no delivery to rate');
    if (order.status !== 'DELIVERED') throw new BadRequestException('This order has not been delivered yet');

    return this.prisma.deliveryRating.upsert({
      where: { deliveryOrderId: order.deliveryOrder.id },
      create: { deliveryOrderId: order.deliveryOrder.id, customerId, rating, tags, comment },
      update: { rating, tags, comment },
    });
  }

  async tipDeliveryPerson(customerId: string, orderId: string, amountRs: number) {
    if (amountRs <= 0) throw new BadRequestException('Tip amount must be positive');

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { deliveryOrder: true } });
    if (order.customerId !== customerId) throw new ForbiddenException('This order does not belong to you');
    if (!order.deliveryOrder) throw new BadRequestException('This order has no delivery to tip');
    if (order.status !== 'DELIVERED') throw new BadRequestException('You can only tip after your order has been delivered');
    if (Number(order.deliveryOrder.tipAmountRs) > 0) throw new BadRequestException('You have already tipped this delivery');

    return this.prisma.$transaction(async (tx: any) => {
      await this.wallet.debit(tx, {
        customerId,
        amountRs,
        type: 'TIP',
        note: `Tip for order #${order.orderNumber}`,
      });
      return tx.deliveryOrder.update({ where: { id: order.deliveryOrder!.id }, data: { tipAmountRs: amountRs } });
    });
  }

  async setDeliveryPreference(customerId: string, orderId: string, preference: 'DONT_RING_BELL' | 'LEAVE_AT_DOOR') {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { deliveryOrder: true } });
    if (order.customerId !== customerId) throw new ForbiddenException('This order does not belong to you');
    if (!order.deliveryOrder) throw new BadRequestException('This order has no delivery to set a preference for');
    if (order.status === 'DELIVERED') throw new BadRequestException('This order has already been delivered');

    return this.prisma.deliveryOrder.update({ where: { id: order.deliveryOrder.id }, data: { deliveryPreference: preference } });
  }

  async notifyStatusChange(orderId: string, status: string, riderName?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { orderNumber: true, customerId: true } });
    if (!order) return;

    const messages: Record<string, { title: string; body: string } | undefined> = {
      ACCEPTED: { title: 'Order Confirmed', body: `Your order #${order.orderNumber} has been accepted and will be prepared shortly.` },
      PREPARING: { title: 'Preparing Your Order', body: `Your order #${order.orderNumber} is being prepared.` },
      READY: { title: 'Order Ready', body: `Your order #${order.orderNumber} is ready!` },
      ASSIGNED: riderName
        ? { title: `${riderName} is your delivery partner`, body: 'They are on their way to pick up your order.' }
        : { title: 'Rider Assigned', body: `A delivery partner has been assigned to order #${order.orderNumber}.` },
      OUT_FOR_DELIVERY: {
        title: 'Order Picked Up',
        body: riderName ? `${riderName} has picked up your order and is on the way!` : `Your order #${order.orderNumber} is on the way!`,
      },
      ARRIVED: { title: 'Your Rider Has Arrived', body: `${riderName ?? 'Your delivery partner'} is at your location.` },
      DELIVERED: { title: 'Order Delivered', body: `Enjoy your order! Don't forget to rate your experience.` },
    };

    const message = messages[status];
    if (!message) return;

    const pushExtras =
      status === 'OUT_FOR_DELIVERY'
        ? {
            actions: [
              { action: 'DONT_RING_BELL', title: "Don't ring the bell" },
              { action: 'LEAVE_AT_DOOR', title: 'Leave at door' },
            ],
            data: { orderId, url: `/orders?highlight=${orderId}` },
          }
        : undefined;

    await this.notificationCenter.notifyCustomer(order.customerId, 'ORDER_UPDATE', message.title, message.body, pushExtras);
  }

  async updateStatus(orderId: string, status: any) {
    const order = await this.prisma.order.update({
      where: { id: orderId },
      data: { status },
      include: { deliveryOrder: { select: { deliveryPersonId: true } } },
    });

    this.gateway.emitOrderStatusUpdate({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      customerId: order.customerId,
      deliveryPersonId: order.deliveryOrder?.deliveryPersonId ?? undefined,
    });

    this.notifyStatusChange(orderId, status).catch(() => undefined);

    return order;
  }
}
