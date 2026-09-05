import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OrderChannel, FulfillmentType, PointsSourceType, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { PointsService } from '../points/points.service';
import { StreaksService } from '../streaks/streaks.service';
import { AttendanceService } from '../streaks/attendance.service';
import { BusinessRulesService } from '../common/business-rules.service';
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
  // A previously-redeemed reward (points already spent, via
  // RewardsService.redeem) being applied to THIS order's total — e.g. a
  // customer redeemed a "₹50 off" reward earlier and is now checking
  // out or paying at the counter. Distinct from couponCode: a coupon is
  // a marketing code anyone can use; this is a specific customer's own
  // already-spent points being honored. The two can stack.
  redemptionId?: string;
  // A staff-entered manual discount — e.g. "knock ₹30 off for a
  // regular customer" or "the last item was slightly damaged." Distinct
  // from couponCode (a marketing code) and redemptionId (a customer's
  // own already-spent points) — this is admin discretion, no code or
  // prior redemption needed. Only ever meaningful for POS/counter sales
  // (a self-service online order has no staff member present to apply
  // one) — the controller enforces that, not this service.
  manualDiscountRs?: number;
  paymentMethod: PaymentMethod;
  // POS/counter sales only: payment is collected in person, so the
  // Payment record is created already PAID (not PENDING), and purchase
  // rewards/e-bill are granted immediately regardless of method — the
  // same treatment CASH already gets for self-service orders.
  markPaidImmediately?: boolean;
  // Set for counter sales so the order records which admin/staff account
  // rang it up. Never set for self-service orders.
  processedByUserId?: string;
  // Required when fulfillmentType is DELIVERY — without these a
  // DeliveryOrder can never be created, and a rider can never be
  // assigned. Not needed for PICKUP.
  deliveryAddress?: string;
  deliveryContactPhone?: string;
  deliveryInstructions?: string;
  // Optional — checked against ShopSettings.deliverablePincodes if the
  // shop has configured any (see isPincodeServiceable). No pincode
  // provided just means no check happens, same as when the shop hasn't
  // configured any serviceable pincodes at all.
  deliveryPincode?: string;
  // Optional real coordinates for the delivery destination, captured
  // from the browser's Geolocation API at checkout — powers a real,
  // live-calculated ETA on the tracking page. No coordinates means no
  // ETA shown, not a broken order — the address string alone is
  // enough for the rider regardless.
  deliveryLat?: number;
  deliveryLng?: number;
  // Client-generated key for offline POS sync — see the schema comment
  // on Order.idempotencyKey. Only ever set by the POS offline queue.
  idempotencyKey?: string;
}

// Loyalty points formula — admin-configurable via BusinessRulesService
// (see common/business-rules.service.ts and grantOrderRewards below).
// The defaults there (÷10 then ×2) match exactly what this system
// always shipped with, so nothing changes for anyone who hasn't
// visited the new business-rules settings screen.

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
  ) {}

  async create(input: CreateOrderInput) {
    if (!input.items.length) throw new BadRequestException('Order must contain at least one item');

    // Shop-closed is a hard stop — no order of any kind (manual, membership,
    // WhatsApp) gets created while the shop is offline.
    const shopOpen = await this.shop.isOpen();
    if (!shopOpen) {
      throw new BadRequestException('We are currently closed. Please try again when we reopen.');
    }

    if (input.fulfillmentType === 'DELIVERY' && (!input.deliveryAddress || !input.deliveryContactPhone)) {
      throw new BadRequestException('A delivery address and contact phone are required for delivery orders');
    }

    // Serviceability check — rejects an order rather than silently
    // accepting a delivery the shop has no real way to fulfil. Only
    // actually checks anything if the shop has configured at least one
    // serviceable pincode AND the order provided one; either being
    // absent means no check happens at all, which keeps this fully
    // backward-compatible with every existing order flow that's never
    // collected a pincode.
    if (input.fulfillmentType === 'DELIVERY' && input.deliveryPincode) {
      const serviceable = await this.shop.isPincodeServiceable(input.deliveryPincode);
      if (!serviceable) {
        throw new BadRequestException(`Sorry, we don't currently deliver to pincode ${input.deliveryPincode}. Try pickup instead?`);
      }
    }

    // Offline POS sync — if this exact queued sale already went through
    // (e.g. the sync ran once, the response was lost to a network flap,
    // and the client retried), return the original order instead of
    // creating a duplicate. A fast pre-check; the DB's unique constraint
    // below is the actual guarantee under a race.
    if (input.idempotencyKey) {
      const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }

    try {
      return await this.createOrderTransaction(input);
    } catch (err) {
      // Two near-simultaneous sync attempts both passed the pre-check
      // above — the unique constraint on idempotencyKey caught the
      // second insert. Treat it the same as finding it up front: return
      // the order that won, not an error.
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
      // 1. Load products + addons, check allergens against customer profile
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

        // Enforce required customisation groups (Base/Flavour/Liquid): each
        // must have exactly one selection from THIS product's own options —
        // prevents missing selections or addon ids borrowed from other products.
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
          // Trimmed and length-capped — kitchen-facing free text, not
          // meant for anything long; a 200-char cap is generous for
          // "no ice, extra hot" while still ruling out someone pasting
          // something absurd into what's meant to be a short note.
          specialInstructions: item.specialInstructions?.trim().slice(0, 200) || undefined,
          addons: { create: chosenAddons.map((a: any) => ({ addonId: a.id, priceRs: a.extraPriceRs })) },
        });
      }

      // 2. Apply coupon — validated properly: must exist, be active, be
      // within its valid date window, and not have exceeded its usage
      // limit. An explicitly-provided invalid coupon fails loudly (the
      // customer typed a code, they should know it didn't work) rather
      // than silently charging full price.
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

      // 2b. Apply a redeemed reward's discount, if one was specified —
      // e.g. a customer redeemed "₹50 off" earlier and is paying at the
      // counter now. Validated properly: must belong to this customer,
      // must not already be used (a redemption can only ever discount
      // one order), and must actually be a DISCOUNT-type reward — a
      // FREE_ITEM/FREE_ADDON reward isn't a flat rupee amount, so
      // applying it here would silently under- or over-discount; those
      // stay handled manually by staff for now (the redemption PDF
      // voucher is the proof) rather than risk getting the math wrong.
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

      // Staff-entered manual discount — validated so a typo or a
      // careless admin can't accidentally create a negative total or
      // discount more than the sale is actually worth.
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

      // Real, server-computed delivery fee — never trusts a
      // client-supplied amount. Only ever runs for DELIVERY orders with
      // real coordinates on file (the same deliveryLat/deliveryLng
      // captured at checkout for the live ETA feature); anything else
      // (PICKUP, DINE_IN, no coordinates, no zones configured) is
      // exactly the same free-delivery behavior as before this feature
      // existed — a quote lookup failure never blocks placing the order.
      let deliveryFeeRs = 0;
      if (input.fulfillmentType === 'DELIVERY' && input.deliveryLat != null && input.deliveryLng != null) {
        const quote = await this.shop.quoteDeliveryFee(input.deliveryLat, input.deliveryLng);
        if (quote) deliveryFeeRs = quote.feeRs;
      }
      // What the customer actually pays — deliberately kept separate
      // from totalRs itself; see the deliveryFeeRs schema comment for
      // why loyalty points and coupon minimums must stay based on
      // totalRs alone.
      const grandTotalRs = totalRs + deliveryFeeRs;

      // 3. Create the order + its payment record (PENDING until confirmed —
      // for CASH that means "collected at counter/delivery", for online
      // methods it means "awaiting gateway confirmation"; POS/counter
      // sales are marked PAID immediately since payment is collected
      // in person before the sale completes)
      //
      // orderNumber can't be computed before the insert — sequenceNumber
      // is assigned by Postgres itself at insert time (a real database
      // autoincrement, not application-generated, so two orders created
      // at the exact same instant can never collide). A temporary
      // placeholder satisfies the unique constraint for this first
      // insert; the real, sequential PP0001-style number is set
      // immediately after, once the real sequence value is known — both
      // writes happen inside this same transaction, so no other request
      // can ever observe the placeholder value.
      const order = await tx.order.create({
        data: {
          orderNumber: `PENDING-${input.idempotencyKey ?? randomUUID()}`,
          idempotencyKey: input.idempotencyKey,
          customerId: input.customerId,
          channel: input.channel,
          fulfillmentType: input.fulfillmentType,
          subtotalRs,
          discountRs,
          totalRs,
          deliveryFeeRs,
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

      // The actual wallet debit — done right after order creation (not
      // before) specifically so it can reference the real orderId, and
      // so that insufficient funds rolls back the whole transaction
      // automatically (this is all one Prisma transaction — throwing
      // here undoes the order insert above too, nothing is left
      // half-created). The payment record above is optimistically
      // marked PAID already; if this throws, none of it actually
      // persists.
      if (input.paymentMethod === 'WALLET') {
        await this.wallet.debit(tx, {
          customerId: input.customerId,
          amountRs: grandTotalRs,
          type: 'ORDER_PAYMENT',
          orderId: order.id,
          note: `Order #${order.orderNumber.startsWith('PENDING-') ? '(pending)' : order.orderNumber}`,
        });
      }

      const orderNumber = `PP${String(order.sequenceNumber).padStart(4, '0')}`;
      await tx.order.update({ where: { id: order.id }, data: { orderNumber } });
      order.orderNumber = orderNumber;

      // 3a. If a reward redemption's discount was applied above, mark it
      // used and record which order it was used on — this is the actual
      // enforcement that stops the same redemption being applied twice.
      if (appliedRedemption) {
        await tx.rewardRedemption.update({
          where: { id: appliedRedemption.id },
          data: { usedAt: new Date(), orderId: order.id },
        });
      }

      // 3b. For delivery orders, create the DeliveryOrder record — without
      // this, a rider can never be assigned and live tracking has nothing
      // to attach to. Also refreshes the customer's saved address so
      // admin always sees their most recent known location.
      if (input.fulfillmentType === 'DELIVERY') {
        await tx.deliveryOrder.create({
          data: {
            orderId: order.id,
            address: input.deliveryAddress,
            deliveryLat: input.deliveryLat,
            deliveryLng: input.deliveryLng,
            contactPhone: input.deliveryContactPhone!,
            deliveryInstructions: input.deliveryInstructions,
            // Shown to the customer on their tracking page; the rider
            // must be given this code back at handover to mark the
            // order DELIVERED — see DeliveryService.updateDeliveryStatus.
            deliveryOtp: String(Math.floor(1000 + Math.random() * 9000)),
          },
        });
        await tx.customer.update({
          where: { id: input.customerId },
          data: { address: input.deliveryAddress },
        });
      }

      // 4. Nutrition log entry
      await tx.nutritionLog.create({
        data: {
          customerId: input.customerId,
          orderId: order.id,
          proteinG: totalProteinG,
          calories: totalCalories,
          carbsG: 0, // populate from full nutrition breakdown in production
          fatG: 0,
          fibreG: 0,
        },
      });

      // 4b. Deduct ingredient stock for whatever was actually ordered.
      // Runs for every channel (website, membership, POS) since stock
      // leaves the shelf the moment the order is placed/prepared,
      // regardless of payment method or timing.
      await this.inventory.deductForOrder(
        tx,
        input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      );

      // 5–7. Points, streak, and protein-goal progress are granted
      // immediately ONLY for POS/counter sales (markPaidImmediately) —
      // cash was genuinely collected in person at that moment. A plain
      // self-checkout CASH order is NOT yet paid (Payment starts PENDING
      // — see step 3 above) even though the method is "CASH", so it must
      // wait for actual collection, exactly like UPI/CARD wait for
      // PaymentsService.confirmPayment(). That collection happens later
      // via AdminService.collectCashPayment() (pickup) or
      // DeliveryService.updateDeliveryStatus('DELIVERED') (delivery) —
      // both of which already grant rewards once cash is actually in
      // hand. Granting here too for plain CASH used to double-grant
      // every self-checkout cash order's points/streak/goal-progress —
      // once at placement, again at collection. Fixed by only trusting
      // markPaidImmediately here.
      if (input.markPaidImmediately) {
        await this.grantOrderRewards(tx, order.id, input.customerId, totalProteinG, totalRs);
      }

      return order;
    }).then((order) => {
      // Emit outside the transaction so the socket broadcast never blocks
      // or gets rolled back by unrelated DB concerns.
      this.gateway.emitOrderStatusUpdate({
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        customerId: input.customerId,
      });

      // CASH orders (and POS/counter sales) are "paid" the moment they're
      // placed, so the e-bill goes out immediately. Online payments get
      // their e-bill from PaymentsService once actually confirmed — never
      // before, matching the same rule as rewards.
      if (input.paymentMethod === 'CASH' || input.markPaidImmediately) {
        this.notificationQueue.queueInvoiceEmail(order.id).catch(() => undefined);
      }

      // WhatsApp order-confirmation notification — a fast env check
      // first avoids an unnecessary customer lookup on every order when
      // this isn't configured yet (see WhatsAppService for what's still
      // needed before this is fully live). WHATSAPP_TEMPLATE_ORDER_CONFIRMED
      // is separately configurable so it's not hardcoded to a template
      // name that may not match whatever gets approved.
      if (process.env.WHATSAPP_AUTH_KEY && process.env.WHATSAPP_TEMPLATE_ORDER_CONFIRMED) {
        this.prisma.customer
          .findUnique({ where: { id: input.customerId }, include: { user: true } })
          .then((customer: { user: { phone: string | null } } | null) => {
            const phone = customer?.user?.phone;
            if (!phone) return;
            this.notificationQueue
              .queueWhatsAppNotification(phone, process.env.WHATSAPP_TEMPLATE_ORDER_CONFIRMED!, [order.orderNumber])
              .catch(() => undefined);
          })
          .catch(() => undefined);
      }

      // In-app notification — this was completely missing for every
      // order (not just POS specifically), even though the whole
      // notification-center feature (inbox, unread badge, etc.) has
      // existed since earlier in this build. Fire-and-forget, same
      // reasoning as everywhere else here: a failure to notify must
      // never affect the order that already succeeded.
      this.notificationCenter
        .notifyCustomer(input.customerId, 'ORDER_UPDATE', 'Order Confirmed', `Your order #${order.orderNumber} has been confirmed.`)
        .catch(() => undefined);

      return order;
    });
  }

  /**
   * Shared by order creation (for CASH, granted immediately) and
   * PaymentsService (for online methods, granted once payment clears).
   * Must be called from within an active transaction.
   */
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
          points: 500, // milestone bonus, tune as needed
          sourceType: PointsSourceType.GOAL_ACHIEVEMENT,
          orderId,
          note: `Completed ${activeGoal.targetProteinG}g protein goal`,
        });
      }
    }

    // Achievement checks — order-count/lifetime-protein and streak-length
    // milestones. Cheap idempotent no-ops if already unlocked.
    await this.achievements.checkOrderAchievements(tx, customerId);
    await this.achievements.checkStreakAchievements(tx, customerId, streak.currentStreakDays);

    // Referral reward — fires exactly once, on a referred customer's
    // genuinely first confirmed order, not at signup. Gating on a real
    // purchase (not just account creation) is what keeps this resistant
    // to trivial abuse — a fake signup with no real order never pays
    // out. Both sides get something: the new customer gets a welcome
    // bonus, the friend who referred them gets a bigger reward for
    // bringing in a real paying customer.
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
            // The customer needs to see their own handoff code so they
            // can read it out to the rider — see
            // DeliveryService.updateDeliveryStatus's OTP check.
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

    // Real aggregate stats for the assigned rider — a genuine average
    // rating and completed-delivery count computed from actual
    // DeliveryRating/DeliveryOrder rows, not a placeholder number.
    // Only computed when a rider is actually assigned, since there's
    // nothing to show otherwise (e.g. a PICKUP order, or a DELIVERY
    // order not yet assigned).
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

  /**
   * Kept separate from product/food reviews per the spec — delivery
   * speed/professionalism is a different thing from food quality.
   * Only the customer who placed the order can rate it, and only once
   * it's actually been delivered.
   */
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

  /**
   * Tipping a rider, paid out of the customer's own wallet balance —
   * deliberately not a separate gateway charge, since tips are
   * typically small (₹20-50) and requiring a whole new Razorpay flow
   * just for that would be disproportionate. If the wallet doesn't
   * have enough, this fails with a clear, honest message rather than
   * silently recording a tip that was never actually paid.
   */
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

  /**
   * Deliberately the loosest validation of any order-mutating method
   * in this file — a customer should be able to set this literally any
   * time between placing the order and it being delivered (including
   * tapping a push notification button before the app has even fully
   * loaded), and it's purely informational for the rider, never gates
   * anything else. Only real ownership and "hasn't been delivered yet"
   * are enforced.
   */
  async setDeliveryPreference(customerId: string, orderId: string, preference: 'DONT_RING_BELL' | 'LEAVE_AT_DOOR') {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { deliveryOrder: true } });
    if (order.customerId !== customerId) throw new ForbiddenException('This order does not belong to you');
    if (!order.deliveryOrder) throw new BadRequestException('This order has no delivery to set a preference for');
    if (order.status === 'DELIVERED') throw new BadRequestException('This order has already been delivered');

    return this.prisma.deliveryOrder.update({ where: { id: order.deliveryOrder.id }, data: { deliveryPreference: preference } });
  }

  /**
   * A real notification fires at every meaningful stage — not just once
   * at order confirmation. This was a genuine gap: the live status
   * stepper updated in real time over the socket, but nothing ever told
   * the customer via push/in-app that a rider had actually been
   * assigned, picked up their order, or arrived. riderName is optional
   * since not every transition involves a rider (accepted/preparing
   * don't).
   */
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
    if (!message) return; // RECEIVED/CANCELLED/FAILED etc. are either covered elsewhere or not customer-facing milestones

    // Action buttons only make sense while the rider is genuinely en
    // route — by the time an order has ARRIVED or been DELIVERED,
    // "don't ring the bell" is too late to matter.
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
