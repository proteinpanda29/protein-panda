import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { OrdersGateway } from '../common/orders.gateway';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BusinessDayLockService } from '../common/business-day-lock.service';
import { getLevelForXp } from '../customers/levels';
import { SegmentsService } from '../customers/segments.service';
import { ExpensesService } from '../expenses/expenses.service';
import { SuppliersService } from '../suppliers/suppliers.service';

// calciumMg/ironMg/potassiumMg were always in the database schema but
// never actually accepted by this create/update logic — meaning the
// admin UI had nowhere to send them even if it wanted to. Optional
// since most products won't specify all of these, only whichever
// actually apply.
interface NutritionInput {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fibreG: number;
  calciumMg?: number | null;
  ironMg?: number | null;
  potassiumMg?: number | null;
}

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private orders: OrdersService,
    private gateway: OrdersGateway,
    private auditLog: AuditLogService,
    private businessDayLock: BusinessDayLockService,
    private segments: SegmentsService,
    private expenses: ExpensesService,
    private suppliers: SuppliersService,
  ) {}

  /**
   * For pay-at-counter cash orders (shop pickup) that never go through a
   * delivery rider — staff marks the cash collected at the register.
   * Mirrors DeliveryService's cash-on-delivery confirmation.
   */
  async collectCashPayment(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
    if (!order || !order.payment) throw new NotFoundException('Order or payment not found');
    if (order.payment.method !== 'CASH') throw new BadRequestException('This order is not a cash payment');
    if (order.payment.status === 'PAID') throw new BadRequestException('Already marked as paid');

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: order.payment!.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      await this.orders.grantOrderRewards(tx, order.id, order.customerId, Number(order.totalProteinG), Number(order.totalRs));
    });

    return { orderId, paid: true };
  }

  /**
   * Rebuilt to answer the questions a business owner actually asks when
   * checking this page, not just raw same-day totals with no context:
   * "is today better or worse than usual" (yesterday comparison), "is
   * anything waiting on me right now" (pending order count), and "how
   * much of today's money is cash vs online" (payment method split —
   * useful heading into a cash-drawer reconciliation).
   */
  async getTodayOverview() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    const [orders, yesterdayOrders, newCustomers] = await Promise.all([
      this.prisma.order.findMany({ where: { createdAt: { gte: startOfToday } }, include: { payment: true } }),
      this.prisma.order.findMany({ where: { createdAt: { gte: startOfYesterday, lt: startOfToday } } }),
      this.prisma.customer.count({ where: { createdAt: { gte: startOfToday } } }),
    ]);

    const totalSalesRs = orders.reduce((sum: number, o: { totalRs: unknown }) => sum + Number(o.totalRs), 0);
    const yesterdayTotalSalesRs = yesterdayOrders.reduce((sum: number, o: { totalRs: unknown }) => sum + Number(o.totalRs), 0);

    // Orders still needing staff attention right now — not yet ready,
    // not yet handed off, not cancelled. The number a business owner
    // actually wants to see at a glance, not buried in a list.
    const ACTIONABLE_STATUSES = ['RECEIVED', 'ACCEPTED', 'PREPARING'];
    const pendingOrderCount = orders.filter((o: { status: string }) => ACTIONABLE_STATUSES.includes(o.status)).length;

    return {
      totalSalesRs,
      orderCount: orders.length,
      newCustomers,
      ordersByChannel: this.groupBy(orders, 'channel'),
      ordersByStatus: this.groupBy(orders, 'status'),
      ordersByPaymentMethod: this.groupBy(
        orders.filter((o: { payment: unknown }) => o.payment),
        (o: any) => o.payment.method,
      ),
      pendingOrderCount,
      yesterdayTotalSalesRs,
      yesterdayOrderCount: yesterdayOrders.length,
    };
  }

  /**
   * The department-specific home screen — real KPIs for whichever
   * department(s) the caller actually holds, reusing the same data
   * each department's own dedicated page already shows rather than
   * running duplicate queries. The Owner (empty departments array)
   * doesn't get this at all — they already have the full
   * getTodayOverview() above as their home screen, which is
   * deliberately broader than any one department's slice.
   */
  async getMyDashboard(departments: string[]) {
    const sections = await Promise.all(
      departments.map(async (dept) => {
        switch (dept) {
          case 'SALES': {
            const overview = await this.getTodayOverview();
            return {
              department: 'SALES',
              title: '💰 Sales & Customer',
              stats: [
                { label: "Today's Sales", value: `₹${overview.totalSalesRs.toLocaleString()}` },
                { label: 'Orders Today', value: String(overview.orderCount) },
                { label: 'Pending Orders', value: String(overview.pendingOrderCount) },
                { label: 'New Customers', value: String(overview.newCustomers) },
              ],
            };
          }
          case 'OPERATIONS': {
            const kitchenQueue = await this.getKitchenQueue();
            return {
              department: 'OPERATIONS',
              title: '👨‍🍳 Operations & Store',
              stats: [
                { label: 'Orders In Kitchen', value: String(kitchenQueue.length) },
                { label: 'Preparing', value: String(kitchenQueue.filter((o: { status: string }) => o.status === 'PREPARING').length) },
                { label: 'Ready for Pickup/Delivery', value: String(kitchenQueue.filter((o: { status: string }) => o.status === 'READY').length) },
              ],
            };
          }
          case 'SUPPLY_CHAIN': {
            const [lowStock, expiring, pendingRequests] = await Promise.all([
              this.lowStockItems(),
              this.listExpiringBatches(),
              this.suppliers.listPurchaseRequests('PENDING'),
            ]);
            return {
              department: 'SUPPLY_CHAIN',
              title: '📦 Supply Chain & Inventory',
              stats: [
                { label: 'Low Stock Items', value: String(lowStock.length) },
                { label: 'Expiring Soon', value: String(expiring.length) },
                { label: 'Pending Purchase Requests', value: String(pendingRequests.length) },
              ],
            };
          }
          case 'LOYALTY': {
            const activeMembers = await this.segments.getSegment('ACTIVE_MEMBERS');
            const closeToReward = await this.segments.getSegment('CLOSE_TO_MONTHLY_REWARD');
            return {
              department: 'LOYALTY',
              title: '🏋️ Loyalty, Fitness & Membership',
              stats: [
                { label: 'Active Members', value: String(activeMembers.length) },
                { label: 'Close to Monthly Reward', value: String(closeToReward.length) },
              ],
            };
          }
          case 'DELIVERY_LOGISTICS': {
            const [availableRiders, allRiders] = await Promise.all([this.listAvailableRiders(), this.listDeliveryPersonnel()]);
            const activeDeliveries = await this.prisma.order.count({ where: { status: { in: ['OUT_FOR_DELIVERY', 'ARRIVED'] } } });
            return {
              department: 'DELIVERY_LOGISTICS',
              title: '🚚 Delivery & Logistics',
              stats: [
                { label: 'Riders On Duty', value: String(availableRiders.length) },
                { label: 'Total Riders', value: String(allRiders.length) },
                { label: 'Active Deliveries', value: String(activeDeliveries) },
              ],
            };
          }
          case 'FINANCE_MARKETING': {
            const today = new Date();
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            const expenseSummary = await this.expenses.getExpenseSummary(weekAgo.toISOString(), today.toISOString());
            return {
              department: 'FINANCE_MARKETING',
              title: '📊 Finance, Marketing & BI',
              stats: [{ label: 'Expenses (Last 7 Days)', value: `₹${Number(expenseSummary.totalRs ?? 0).toLocaleString()}` }],
            };
          }
          default:
            return null;
        }
      }),
    );

    return sections.filter((s) => s !== null);
  }

  async lowStockItems() {
    const items = await this.prisma.inventoryItem.findMany({ include: { ingredient: true } });
    return items.filter((i: { quantityOnHand: unknown; reorderLevel: unknown }) => Number(i.quantityOnHand) <= Number(i.reorderLevel));
  }

  async listDeliveryPersonnel() {
    return this.prisma.deliveryPerson.findMany({
      orderBy: [{ isOnDuty: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { deliveryOrders: true } },
        deliveryOrders: {
          where: { order: { status: 'OUT_FOR_DELIVERY' } },
          select: { orderId: true, order: { select: { orderNumber: true } } },
        },
      },
    });
  }

  // ---- Orders (kitchen/admin view) ----

  /**
   * A deliberately narrower view than listOrders — just what a kitchen
   * screen actually needs: which items, which add-ons, and whether the
   * customer has any recorded allergy at all (not just an allergen that
   * conflicts with this specific item — a kitchen worker plating the
   * order should know a customer has *any* allergy as a general
   * cross-contamination caution, since that's a real safety concern
   * regardless of whether this particular item's declared allergens
   * happen to overlap). Only RECEIVED/ACCEPTED/PREPARING/READY orders —
   * a kitchen screen has no reason to show DELIVERED or CANCELLED ones.
   */
  async getKitchenQueue() {
    return this.prisma.order.findMany({
      where: { status: { in: ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY'] } },
      orderBy: { createdAt: 'asc' }, // oldest first — first in, first cooked
      include: {
        customer: { include: { allergies: { include: { allergen: true } } } },
        items: {
          include: {
            product: { select: { name: true } },
            addons: { include: { addon: { select: { name: true } } } },
          },
        },
      },
    });
  }

  async listOrders(params: { status?: string; take?: number; cursor?: string }) {
    const { status, take = 25, cursor } = params;
    return this.prisma.order.findMany({
      where: status ? { status: status as any } : undefined,
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { name: true } },
        items: { include: { product: { select: { name: true } } } },
        payment: { select: { method: true, status: true, amountRs: true } },
        deliveryOrder: {
          select: {
            id: true,
            address: true,
            deliveryPersonId: true,
            deliveryPerson: { select: { name: true } },
          },
        },
      },
    });
  }

  /** Only riders currently on duty can be assigned — matches the delivery page's own duty toggle. */
  /**
   * Ranks on-duty riders by real, available signals — deliberately NOT
   * distance-to-destination, since neither an idle rider's live position
   * nor a geocoded destination coordinate exists anywhere in this system
   * (DeliveryOrder.address is a plain text string, and a rider's
   * lastLat/lastLng is only ever recorded once they're already mid-
   * delivery). Faking a distance number from data that doesn't exist
   * would be worse than not having one — this ranks by what's actually
   * measurable instead:
   *   1. Current active-delivery workload, fewest first — the doc's own
   *      worked example (nearest-but-busy vs. farther-but-free) is really
   *      making this exact point: workload matters more than proximity
   *      when proximity data isn't reliable anyway.
   *   2. Tie-broken by longest idle time since their last delivery, so
   *      work rotates fairly across riders rather than always landing on
   *      whoever happens to sort first alphabetically.
   */
  async listAvailableRiders() {
    const riders = await this.prisma.deliveryPerson.findMany({ where: { isOnDuty: true } });

    const ranked = await Promise.all(
      riders.map(async (rider: { id: string; name: string; vehicleInfo: string | null; isOnDuty: boolean }) => {
        const activeDeliveries = await this.prisma.deliveryOrder.count({
          where: { deliveryPersonId: rider.id, order: { status: { in: ['ASSIGNED', 'OUT_FOR_DELIVERY'] } } },
        });
        const lastCompleted = await this.prisma.deliveryOrder.findFirst({
          where: { deliveryPersonId: rider.id, deliveredAt: { not: null } },
          orderBy: { deliveredAt: 'desc' },
          select: { deliveredAt: true },
        });
        return { ...rider, activeDeliveries, lastDeliveredAt: lastCompleted?.deliveredAt ?? null };
      }),
    );

    return ranked.sort((a, b) => {
      if (a.activeDeliveries !== b.activeDeliveries) return a.activeDeliveries - b.activeDeliveries;
      const aTime = a.lastDeliveredAt ? new Date(a.lastDeliveredAt).getTime() : 0;
      const bTime = b.lastDeliveredAt ? new Date(b.lastDeliveredAt).getTime() : 0;
      return aTime - bTime; // longer-idle (smaller timestamp) goes first
    });
  }

  /** The top of the same ranking listAvailableRiders produces — for the "Auto-Assign Best Rider" button. */
  async suggestBestRider() {
    const ranked = await this.listAvailableRiders();
    return ranked[0] ?? null;
  }

  async autoAssignBestRider(orderId: string) {
    const best = await this.suggestBestRider();
    if (!best) throw new BadRequestException('No riders are currently on duty');
    return this.assignDeliveryRider(orderId, best.id);
  }

  async assignDeliveryRider(orderId: string, deliveryPersonId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { deliveryOrder: true },
    });
    if (!order.deliveryOrder) {
      throw new BadRequestException('This order is not a delivery order (no DeliveryOrder record — was it placed for pickup?)');
    }
    const rider = await this.prisma.deliveryPerson.findUnique({ where: { id: deliveryPersonId } });
    if (!rider || !rider.isOnDuty) {
      throw new BadRequestException('That rider is not currently on duty');
    }

    const [deliveryOrder, updatedOrder] = await this.prisma.$transaction([
      this.prisma.deliveryOrder.update({
        where: { id: order.deliveryOrder.id },
        data: { deliveryPersonId, assignedAt: new Date() },
      }),
      this.prisma.order.update({ where: { id: orderId }, data: { status: 'ASSIGNED' } }),
    ]) as [any, any];

    this.gateway.emitOrderStatusUpdate({
      orderId: updatedOrder.id,
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      customerId: updatedOrder.customerId,
      deliveryPersonId,
    });

    this.orders.notifyStatusChange(orderId, 'ASSIGNED', rider.name).catch(() => undefined);

    return deliveryOrder;
  }

  // ---- Customers ----

  async listCustomers(params: { take?: number; cursor?: string; search?: string }) {
    const { take = 25, cursor, search } = params;
    return this.prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { user: { phone: { contains: search } } },
              { user: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : undefined,
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { phone: true, email: true } },
        streak: true,
        pointsBalance: true,
        _count: { select: { orders: true } },
      },
    });
  }

  /** Full profile for the admin customer-detail view: contact, location, and order/food history. */
  /**
   * Blocking, not deleting — an admin ending an abusive customer's
   * access without destroying their order history (needed for
   * accounting/tax records regardless). Reuses the exact same
   * isActive flag a customer's own self-deletion already sets, which
   * is already checked on every request (login, WebSocket
   * connections) — this doesn't introduce a second, parallel
   * access-control mechanism, just a second way of setting the same
   * one.
   */
  async setCustomerActive(customerId: string, isActive: boolean, actorUserId?: string, actorRole?: 'ADMIN' | 'CUSTOMER' | 'DELIVERY') {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const updated = await this.prisma.user.update({ where: { id: customer.userId }, data: { isActive } });

    if (actorUserId) {
      this.auditLog
        .record({
          actorUserId,
          actorRole: actorRole ?? 'ADMIN',
          action: isActive ? 'CUSTOMER_UNBLOCKED' : 'CUSTOMER_BLOCKED',
          entityType: 'Customer',
          entityId: customerId,
          summary: `${customer.name} was ${isActive ? 'unblocked' : 'blocked'}`,
        })
        .catch(() => undefined);
    }

    return updated;
  }

  /**
   * Customer 360 — everything about one customer assembled into a
   * single response: profile, order history, spend/AOV, favourite
   * product, membership, XP level, reviews, and support tickets. All
   * of this data already existed scattered across separate
   * endpoints/pages; this just brings it together the way an admin
   * actually needs it when looking at one specific customer.
   */
  async getCustomerDetail(customerId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: {
        user: { select: { phone: true, email: true, isActive: true } },
        streak: true,
        pointsBalance: true,
        allergies: { include: { allergen: true } },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            items: { include: { product: { select: { name: true } } } },
            payment: { select: { method: true, status: true } },
          },
        },
        memberships: { orderBy: { createdAt: 'desc' }, take: 1 },
        reviews: { orderBy: { createdAt: 'desc' }, take: 10, include: { product: { select: { name: true } } } },
        supportTickets: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, subject: true, status: true, createdAt: true } },
      },
    });

    // Lifetime spend/AOV/favourite product — computed from ALL orders,
    // not just the 20 most recent shown above, so these numbers are
    // genuinely accurate rather than an approximation from a limited
    // page of history.
    const [spendAgg, orderCount, favouriteProductAgg, xpAgg] = await Promise.all([
      this.prisma.order.aggregate({
        where: { customerId, status: { notIn: ['CANCELLED', 'FAILED'] } },
        _sum: { totalRs: true },
      }),
      this.prisma.order.count({ where: { customerId, status: { notIn: ['CANCELLED', 'FAILED'] } } }),
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        where: { order: { customerId, status: { notIn: ['CANCELLED', 'FAILED'] } } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 1,
      }),
      this.prisma.pointsLedgerEntry.aggregate({ where: { customerId }, _sum: { points: true } }),
    ]);

    const totalSpendRs = Number(spendAgg._sum.totalRs ?? 0);
    const avgOrderValueRs = orderCount > 0 ? totalSpendRs / orderCount : 0;

    let favouriteProduct: { id: string; name: string } | null = null;
    if (favouriteProductAgg.length > 0) {
      const product = await this.prisma.product.findUnique({ where: { id: favouriteProductAgg[0].productId }, select: { id: true, name: true } });
      favouriteProduct = product;
    }

    const xp = xpAgg._sum.points ?? 0;

    return {
      ...customer,
      totalSpendRs,
      totalOrderCount: orderCount,
      avgOrderValueRs,
      favouriteProduct,
      xpLevel: getLevelForXp(xp),
      activeMembership: customer.memberships[0]?.status === 'ACTIVE' ? customer.memberships[0] : null,
    };
  }

  // ---- Products ----

  async listAllProducts() {
    return this.prisma.product.findMany({
      orderBy: { name: 'asc' },
      include: { category: true, nutrition: true },
    });
  }

  async createProduct(data: {
    name: string;
    slug: string;
    categoryId: string;
    basePriceRs: number;
    isVeg: boolean;
    prepTimeMinutes?: number;
    nutrition?: NutritionInput;
  }) {
    const { nutrition, ...productData } = data;
    return this.prisma.product.create({
      data: {
        ...productData,
        ...(nutrition ? { nutrition: { create: nutrition } } : {}),
      },
      include: { nutrition: true, category: true },
    });
  }

  async updateProduct(
    id: string,
    data: Partial<{
      name: string;
      description: string;
      basePriceRs: number;
      isActive: boolean;
      isVeg: boolean;
      isCustomisable: boolean;
      categoryId: string;
      prepTimeMinutes: number;
      packagingCostRs: number;
      nutrition: NutritionInput;
    }>,
    actorUserId?: string,
    actorRole?: 'ADMIN' | 'CUSTOMER' | 'DELIVERY',
  ) {
    const { nutrition, ...productData } = data;

    // Only fetched when there's actually an actor to attribute a price
    // change to (e.g. not for internal/system calls that never pass
    // one) — this avoids an extra query on every single product edit
    // when nothing is even going to get logged.
    let priceBefore: number | null = null;
    if (actorUserId && data.basePriceRs !== undefined) {
      // A real price change is exactly the kind of "sensitive
      // modification" the closed-day lock exists for — everything else
      // about editing a product (description, availability toggle)
      // stays unaffected, matching the audit-log gate right below,
      // which also only fires for genuine price changes.
      await this.businessDayLock.assertNotClosed('changing a product price');
      const existing = await this.prisma.product.findUnique({ where: { id }, select: { basePriceRs: true, name: true } });
      priceBefore = existing ? Number(existing.basePriceRs) : null;
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...productData,
        ...(nutrition ? { nutrition: { upsert: { create: nutrition, update: nutrition } } } : {}),
      },
      include: { nutrition: true, category: true },
    });

    if (actorUserId && priceBefore !== null && data.basePriceRs !== undefined && priceBefore !== data.basePriceRs) {
      this.auditLog
        .record({
          actorUserId,
          actorRole: actorRole ?? 'ADMIN',
          action: 'PRODUCT_PRICE_CHANGED',
          entityType: 'Product',
          entityId: id,
          summary: `${updated.name}: price changed from ₹${priceBefore} to ₹${data.basePriceRs}`,
          metadata: { from: priceBefore, to: data.basePriceRs },
        })
        .catch(() => undefined);
    }

    return updated;
  }

  async getProductDetail(id: string) {
    return this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: {
        nutrition: true,
        category: true,
        allergens: { include: { allergen: true } },
        addonOptions: true,
        ingredients: { include: { ingredient: true } },
      },
    });
  }

  async listCategories() {
    return this.prisma.productCategory.findMany({ orderBy: { name: 'asc' } });
  }

  async createCategory(data: { name: string; slug: string }) {
    return this.prisma.productCategory.create({ data });
  }

  async updateCategory(id: string, data: Partial<{ name: string; slug: string }>) {
    return this.prisma.productCategory.update({ where: { id }, data });
  }

  // ---- Allergens ----

  async listAllergens() {
    return this.prisma.allergen.findMany({ orderBy: { name: 'asc' } });
  }

  async createAllergen(name: string) {
    return this.prisma.allergen.create({ data: { name } });
  }

  /** Replaces the full set of allergen links for a product in one go. */
  async setProductAllergens(productId: string, allergenIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.productAllergen.deleteMany({ where: { productId } }),
      this.prisma.productAllergen.createMany({
        data: allergenIds.map((allergenId) => ({ productId, allergenId })),
      }),
    ]);
    return this.prisma.productAllergen.findMany({ where: { productId }, include: { allergen: true } });
  }

  // ---- Customisation options (Base/Flavour/Liquid/Add-on) ----

  async createProductAddon(
    productId: string,
    data: { group: string; name: string; isRequired?: boolean; extraPriceRs?: number; extraProteinG?: number; extraCalories?: number },
  ) {
    return this.prisma.productAddon.create({
      data: {
        productId,
        group: data.group as any,
        name: data.name,
        isRequired: data.isRequired ?? false,
        extraPriceRs: data.extraPriceRs ?? 0,
        extraProteinG: data.extraProteinG,
        extraCalories: data.extraCalories,
      },
    });
  }

  async updateProductAddon(addonId: string, data: Partial<{ name: string; isRequired: boolean; extraPriceRs: number; extraProteinG: number; extraCalories: number }>) {
    return this.prisma.productAddon.update({ where: { id: addonId }, data });
  }

  async deleteProductAddon(addonId: string) {
    return this.prisma.productAddon.delete({ where: { id: addonId } });
  }

  // ---- Recipe (ingredient links) — powers inventory deduction on sale ----

  async listIngredientsPlain() {
    return this.prisma.ingredient.findMany({ orderBy: { name: 'asc' } });
  }

  async setProductIngredient(productId: string, ingredientId: string, quantity: number) {
    return this.prisma.productIngredient.upsert({
      where: { productId_ingredientId: { productId, ingredientId } },
      create: { productId, ingredientId, quantity },
      update: { quantity },
    });
  }

  async removeProductIngredient(productId: string, ingredientId: string) {
    return this.prisma.productIngredient.delete({
      where: { productId_ingredientId: { productId, ingredientId } },
    });
  }

  // ---- POS Analytics ----

  /**
   * Everything a counter/admin needs to understand sales performance:
   * payment method split, average order value, hourly distribution
   * (today only — a week/month view of hourly buckets isn't meaningful),
   * best/slow sellers, and discounts given. Computed on demand from
   * existing order/payment/item data — nothing new is stored.
   */
  async getPosAnalytics(range: 'today' | 'week' | 'month' = 'today') {
    const start = new Date();
    if (range === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (range === 'week') {
      start.setDate(start.getDate() - 7);
    } else {
      start.setDate(start.getDate() - 30);
    }

    const [orders, payments, orderItems] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: { gte: start }, status: { not: 'CANCELLED' } },
        select: { id: true, totalRs: true, discountRs: true, createdAt: true, channel: true, customerId: true },
      }),
      this.prisma.payment.findMany({
        where: { status: 'PAID', paidAt: { gte: start } },
        select: { method: true, amountRs: true },
      }),
      this.prisma.orderItem.findMany({
        where: { order: { createdAt: { gte: start }, status: { not: 'CANCELLED' } } },
        select: { quantity: true, product: { select: { id: true, name: true, isActive: true } } },
      }),
    ]);

    const totalSalesRs = orders.reduce((sum: number, o: { totalRs: unknown }) => sum + Number(o.totalRs), 0);
    const orderCount = orders.length;
    const avgOrderValueRs = orderCount > 0 ? totalSalesRs / orderCount : 0;
    const discountsGivenRs = orders.reduce((sum: number, o: { discountRs: unknown }) => sum + Number(o.discountRs), 0);

    const paymentBreakdown: Record<string, number> = {};
    for (const p of payments) {
      paymentBreakdown[p.method] = (paymentBreakdown[p.method] ?? 0) + Number(p.amountRs);
    }

    // Dine-in = counter/POS sales (IN_STORE channel). Everything else —
    // website, app, WhatsApp, membership, Swiggy/Zomato — counts as online.
    const dineInVsOnline = { dineInRs: 0, dineInCount: 0, onlineRs: 0, onlineCount: 0 };
    for (const o of orders) {
      if (o.channel === 'IN_STORE') {
        dineInVsOnline.dineInRs += Number(o.totalRs);
        dineInVsOnline.dineInCount += 1;
      } else {
        dineInVsOnline.onlineRs += Number(o.totalRs);
        dineInVsOnline.onlineCount += 1;
      }
    }

    let hourlySales: { hour: number; totalRs: number }[] | null = null;
    if (range === 'today') {
      const buckets = new Array(24).fill(0);
      for (const o of orders) {
        buckets[new Date(o.createdAt).getHours()] += Number(o.totalRs);
      }
      hourlySales = buckets.map((totalRs, hour) => ({ hour, totalRs }));
    }

    const qtyByProduct = new Map<string, { name: string; qty: number }>();
    for (const item of orderItems) {
      const existing = qtyByProduct.get(item.product.id);
      qtyByProduct.set(item.product.id, {
        name: item.product.name,
        qty: (existing?.qty ?? 0) + item.quantity,
      });
    }
    const ranked = [...qtyByProduct.values()].sort((a, b) => b.qty - a.qty);

    // New vs returning + top customers by spend — a customer is
    // "returning" if they had at least one order (of any status,
    // including this period's own prior orders) BEFORE this reporting
    // window started; everyone else who ordered in-window is "new" to
    // the business, not just new to this window. Retention rate here
    // means "what share of everyone who bought something in this
    // window were people coming back," a standard, defensible
    // definition — not a guess at a more complex cohort calculation.
    const spendByCustomer = new Map<string, { customerId: string; totalRs: number }>();
    for (const o of orders) {
      const existing = spendByCustomer.get(o.customerId);
      spendByCustomer.set(o.customerId, { customerId: o.customerId, totalRs: (existing?.totalRs ?? 0) + Number(o.totalRs) });
    }
    const customerIdsThisWindow = [...spendByCustomer.keys()];

    let newCustomersCount = 0;
    let returningCustomersCount = 0;
    let topCustomers: { customerId: string; name: string; totalRs: number }[] = [];

    if (customerIdsThisWindow.length > 0) {
      const priorOrderCustomerIds = await this.prisma.order.findMany({
        where: { customerId: { in: customerIdsThisWindow }, createdAt: { lt: start }, status: { not: 'CANCELLED' } },
        select: { customerId: true },
        distinct: ['customerId'],
      });
      const returningSet = new Set(priorOrderCustomerIds.map((o: { customerId: string }) => o.customerId));
      newCustomersCount = customerIdsThisWindow.filter((id) => !returningSet.has(id)).length;
      returningCustomersCount = customerIdsThisWindow.length - newCustomersCount;

      const topSpenders = [...spendByCustomer.values()].sort((a, b) => b.totalRs - a.totalRs).slice(0, 5);
      const customers = await this.prisma.customer.findMany({
        where: { id: { in: topSpenders.map((s) => s.customerId) } },
        select: { id: true, name: true },
      });
      const nameById = new Map<string, string>(customers.map((c: { id: string; name: string }) => [c.id, c.name]));
      topCustomers = topSpenders.map((s) => ({ customerId: s.customerId, name: nameById.get(s.customerId) ?? 'Unknown', totalRs: s.totalRs }));
    }

    const retentionRatePct = customerIdsThisWindow.length > 0 ? (returningCustomersCount / customerIdsThisWindow.length) * 100 : 0;

    return {
      range,
      totalSalesRs,
      orderCount,
      avgOrderValueRs,
      dineInVsOnline,
      discountsGivenRs,
      paymentBreakdown,
      hourlySales,
      bestSelling: ranked.slice(0, 5),
      slowMoving: ranked.slice(-5).reverse(),
      newCustomersCount,
      returningCustomersCount,
      retentionRatePct,
      topCustomers,
    };
  }

  async listInventory() {
    return this.prisma.inventoryItem.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { ingredient: true },
    });
  }

  /** Manually create a new ingredient + its starting stock record — for adding items the recipe seed didn't cover. */
  async createIngredient(data: {
    name: string;
    unit: string;
    initialQuantity: number;
    reorderLevel: number;
    batchNumber?: string;
    expiryDate?: string;
    supplierName?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const ingredient = await tx.ingredient.create({ data: { name: data.name, unit: data.unit } });
      const inventoryItem = await tx.inventoryItem.create({
        data: { ingredientId: ingredient.id, quantityOnHand: data.initialQuantity, reorderLevel: data.reorderLevel },
        include: { ingredient: true },
      });

      if (data.initialQuantity > 0) {
        await tx.ingredientBatch.create({
          data: {
            ingredientId: ingredient.id,
            batchNumber: data.batchNumber?.trim() || `INIT-${Date.now()}`,
            supplierName: data.supplierName,
            quantityReceived: data.initialQuantity,
            quantityRemaining: data.initialQuantity,
            expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
          },
        });
      }

      return inventoryItem;
    });
  }

  /**
   * Manual stock addition (delivery arrived) or correction — always
   * logged as an auditable StockMovement. A positive amount also creates
   * a new batch (with optional number/expiry/supplier) so FEFO
   * consumption and expiry warnings have something to work with; a
   * negative amount is treated as a plain correction against the
   * aggregate total, not attributed to any specific batch — use
   * recordWastage() instead when the loss is traceable to one batch.
   */
  async restock(
    inventoryItemId: string,
    amount: number,
    note?: string,
    batchDetails?: { batchNumber?: string; expiryDate?: string; supplierName?: string },
  ) {
    if (amount === 0) throw new BadRequestException('Amount must be non-zero');

    return this.prisma.$transaction(async (tx) => {
      const inventoryItem = await tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: { quantityOnHand: { increment: amount } },
        include: { ingredient: true },
      });

      await tx.stockMovement.create({
        data: {
          inventoryItemId,
          type: amount > 0 ? 'RESTOCK' : 'ADJUSTMENT',
          quantity: amount,
          note: note ?? (amount > 0 ? 'Manual restock' : 'Manual adjustment'),
        },
      });

      if (amount > 0) {
        await tx.ingredientBatch.create({
          data: {
            ingredientId: inventoryItem.ingredientId,
            batchNumber: batchDetails?.batchNumber?.trim() || `RESTOCK-${Date.now()}`,
            supplierName: batchDetails?.supplierName,
            quantityReceived: amount,
            quantityRemaining: amount,
            expiryDate: batchDetails?.expiryDate ? new Date(batchDetails.expiryDate) : null,
          },
        });
      }

      return inventoryItem;
    });
  }

  /**
   * Logs spoiled/damaged/expired stock against a specific batch — unlike
   * a generic negative restock/adjustment, this is traceable to exactly
   * which delivery went bad, which is the whole point of tracking
   * batches in the first place.
   */
  async recordWastage(batchId: string, quantity: number, reason: string, actorUserId?: string, actorRole?: 'ADMIN' | 'CUSTOMER' | 'DELIVERY') {
    if (quantity <= 0) throw new BadRequestException('Quantity must be positive');
    if (!reason?.trim()) throw new BadRequestException('A reason is required');

    const batch = await this.prisma.ingredientBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { ingredient: { include: { stock: true } } },
    });
    if (quantity > Number(batch.quantityRemaining)) {
      throw new BadRequestException(`Cannot waste more than the ${batch.quantityRemaining} remaining in this batch`);
    }
    const inventoryItem = batch.ingredient.stock;
    if (!inventoryItem) throw new BadRequestException('No inventory record for this ingredient');

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.ingredientBatch.update({ where: { id: batchId }, data: { quantityRemaining: { decrement: quantity } } });
      await tx.inventoryItem.update({ where: { id: inventoryItem.id }, data: { quantityOnHand: { decrement: quantity } } });
      return tx.stockMovement.create({
        data: { inventoryItemId: inventoryItem.id, batchId, type: 'WASTAGE', quantity: -quantity, note: reason },
      });
    });

    if (actorUserId) {
      this.auditLog
        .record({
          actorUserId,
          actorRole: actorRole ?? 'ADMIN',
          action: 'INVENTORY_WASTAGE_RECORDED',
          entityType: 'IngredientBatch',
          entityId: batchId,
          summary: `${batch.ingredient.name}: ${quantity} ${batch.ingredient.unit} wasted — ${reason}`,
          metadata: { quantity, reason, ingredientId: batch.ingredientId },
        })
        .catch(() => undefined);
    }

    return result;
  }

  /** Batches expiring within `daysAhead` days that still have stock remaining — the "expires tomorrow" warning list. */
  async listExpiringBatches(daysAhead = 3) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + daysAhead);
    return this.prisma.ingredientBatch.findMany({
      where: { quantityRemaining: { gt: 0 }, expiryDate: { not: null, lte: threshold } },
      orderBy: { expiryDate: 'asc' },
      include: { ingredient: true },
    });
  }

  /** All batches with stock left for one ingredient, in FEFO order — for manual reference / picking which batch to log wastage against. */
  async listBatchesForIngredient(ingredientId: string) {
    return this.prisma.ingredientBatch.findMany({
      where: { ingredientId, quantityRemaining: { gt: 0 } },
      orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
    });
  }

  async listStockMovements(take = 30) {
    return this.prisma.stockMovement.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      include: { inventoryItem: { include: { ingredient: true } }, product: { select: { name: true } } },
    });
  }

  // ---- AI safety audit log ----

  /** Recent AI conversations that touched a sensitive medical topic — real oversight, not just trusting the system prompt. */
  async listAiSafetyFlags(take = 50) {
    return this.prisma.aiSafetyFlag.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true } } },
    });
  }

  // ---- Product costing ----

  /**
   * Real food cost per product, computed from its recipe
   * (ProductIngredient) × each ingredient's current cost estimate
   * (Ingredient.costPerUnitRs, kept up to date by every Purchase).
   * Deliberately does NOT include add-on costs — ProductAddon isn't
   * linked to Ingredient in the schema (same known limitation as
   * inventory deduction), so a customized shake's true cost is slightly
   * understated. Flagged via `hasUnknownCosts`/addon exclusion rather
   * than silently pretending the number is exact.
   */
  async getProductCosting(productId: string) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { ingredients: { include: { ingredient: true } } },
    });

    const ingredientCosts = product.ingredients.map((pi: { quantity: unknown; ingredient: { name: string; unit: string; costPerUnitRs: unknown } }) => {
      const costPerUnitRs = pi.ingredient.costPerUnitRs !== null ? Number(pi.ingredient.costPerUnitRs) : null;
      return {
        ingredientName: pi.ingredient.name,
        quantity: Number(pi.quantity),
        unit: pi.ingredient.unit,
        costPerUnitRs,
        lineCostRs: costPerUnitRs !== null ? Number(pi.quantity) * costPerUnitRs : 0,
        costKnown: costPerUnitRs !== null,
      };
    });

    const foodCostRs = ingredientCosts.reduce((sum: number, i: { lineCostRs: number }) => sum + i.lineCostRs, 0);
    const packagingCostRs = Number(product.packagingCostRs ?? 0);
    const totalCostRs = foodCostRs + packagingCostRs;
    const priceRs = Number(product.basePriceRs);
    const grossMarginRs = priceRs - totalCostRs;
    const grossMarginPct = priceRs > 0 ? (grossMarginRs / priceRs) * 100 : 0;

    return {
      productId,
      productName: product.name,
      priceRs,
      ingredientCosts,
      foodCostRs,
      packagingCostRs,
      totalCostRs,
      grossMarginRs,
      grossMarginPct,
      hasUnknownCosts: ingredientCosts.some((i: { costKnown: boolean }) => !i.costKnown),
      hasNoRecipe: product.ingredients.length === 0,
    };
  }

  /**
   * A scan across every active product's margin, worst first — the
   * quickest way to spot a product a coupon or game reward could
   * accidentally push into negative territory.
   */
  async listProductCostingSummary() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      include: { ingredients: { include: { ingredient: true } } },
    });

    return products
      .map((p: { id: string; name: string; basePriceRs: unknown; packagingCostRs: unknown; ingredients: { quantity: unknown; ingredient: { costPerUnitRs: unknown } }[] }) => {
        const foodCostRs = p.ingredients.reduce(
          (sum: number, pi: { quantity: unknown; ingredient: { costPerUnitRs: unknown } }) =>
            sum + Number(pi.quantity) * Number(pi.ingredient.costPerUnitRs ?? 0),
          0,
        );
        const totalCostRs = foodCostRs + Number(p.packagingCostRs ?? 0);
        const priceRs = Number(p.basePriceRs);
        const grossMarginRs = priceRs - totalCostRs;
        const grossMarginPct = priceRs > 0 ? (grossMarginRs / priceRs) * 100 : 0;
        return { productId: p.id, name: p.name, priceRs, totalCostRs, grossMarginRs, grossMarginPct };
      })
      .sort((a: { grossMarginPct: number }, b: { grossMarginPct: number }) => a.grossMarginPct - b.grossMarginPct);
  }

  // ---- Rewards ----

  async listRewards() {
    return this.prisma.reward.findMany({ orderBy: { pointsCost: 'asc' } });
  }

  async createReward(data: { name: string; description?: string; type: string; pointsCost: number; valueRs?: number }) {
    return this.prisma.reward.create({
      data: {
        name: data.name,
        description: data.description,
        type: data.type as any,
        pointsCost: data.pointsCost,
        valueRs: data.valueRs,
      },
    });
  }

  async updateReward(id: string, data: Partial<{ name: string; description: string; pointsCost: number; valueRs: number; isActive: boolean }>, actorUserId?: string, actorRole?: 'ADMIN' | 'CUSTOMER' | 'DELIVERY') {
    let before: { name: string; pointsCost: number } | null = null;
    if (actorUserId && data.pointsCost !== undefined) {
      before = await this.prisma.reward.findUnique({ where: { id }, select: { name: true, pointsCost: true } });
    }

    const updated = await this.prisma.reward.update({ where: { id }, data });

    if (actorUserId && before && data.pointsCost !== undefined && Number(before.pointsCost) !== data.pointsCost) {
      this.auditLog
        .record({
          actorUserId,
          actorRole: actorRole ?? 'ADMIN',
          action: 'REWARD_COST_CHANGED',
          entityType: 'Reward',
          entityId: id,
          summary: `${before.name}: points cost changed from ${before.pointsCost} to ${data.pointsCost}`,
          metadata: { from: Number(before.pointsCost), to: data.pointsCost },
        })
        .catch(() => undefined);
    }

    return updated;
  }

  // ---- Coupons ----

  async listCoupons() {
    return this.prisma.coupon.findMany({ orderBy: { validFrom: 'desc' } });
  }

  async createCoupon(data: {
    code: string;
    description?: string;
    discountRs?: number;
    discountPct?: number;
    validFrom: string;
    validUntil: string;
    usageLimit?: number;
  }) {
    if (!data.discountRs && !data.discountPct) {
      throw new BadRequestException('A coupon needs either a flat discount (discountRs) or a percentage (discountPct)');
    }
    return this.prisma.coupon.create({
      data: {
        code: data.code.toUpperCase().trim(),
        description: data.description,
        discountRs: data.discountRs,
        discountPct: data.discountPct,
        validFrom: new Date(data.validFrom),
        validUntil: new Date(data.validUntil),
        usageLimit: data.usageLimit,
      },
    });
  }

  async updateCoupon(id: string, data: Partial<{ description: string; isActive: boolean; validUntil: string; usageLimit: number }>, actorUserId?: string, actorRole?: 'ADMIN' | 'CUSTOMER' | 'DELIVERY') {
    const { validUntil, ...rest } = data;

    // Deactivating/reactivating a coupon is the sensitive edge here —
    // it changes what every customer can redeem right now, so it goes
    // through the same closed-day lock as price changes and refunds.
    if (data.isActive !== undefined) {
      await this.businessDayLock.assertNotClosed('changing a coupon\'s active status');
    }

    let before: { code: string; isActive: boolean } | null = null;
    if (actorUserId && data.isActive !== undefined) {
      before = await this.prisma.coupon.findUnique({ where: { id }, select: { code: true, isActive: true } });
    }

    const updated = await this.prisma.coupon.update({
      where: { id },
      data: { ...rest, ...(validUntil ? { validUntil: new Date(validUntil) } : {}) },
    });

    if (actorUserId && before && data.isActive !== undefined && before.isActive !== data.isActive) {
      this.auditLog
        .record({
          actorUserId,
          actorRole: actorRole ?? 'ADMIN',
          action: data.isActive ? 'COUPON_ACTIVATED' : 'COUPON_DEACTIVATED',
          entityType: 'Coupon',
          entityId: id,
          summary: `Coupon ${before.code} was ${data.isActive ? 'activated' : 'deactivated'}`,
        })
        .catch(() => undefined);
    }

    return updated;
  }

  // ---- Games & Levels ----

  async listGames() {
    return this.prisma.game.findMany({
      orderBy: { name: 'asc' },
      include: { levels: { orderBy: { levelNumber: 'asc' } } },
    });
  }

  async createGame(data: { name: string; description?: string }) {
    if (!data.name?.trim()) throw new BadRequestException('Game name is required');
    const existing = await this.prisma.game.findUnique({ where: { name: data.name } });
    if (existing) throw new BadRequestException('A game with this name already exists');
    return this.prisma.game.create({ data: { name: data.name.trim(), description: data.description } });
  }

  async updateGame(id: string, data: Partial<{ name: string; description: string; isActive: boolean }>) {
    return this.prisma.game.update({ where: { id }, data });
  }

  async createGameLevel(
    gameId: string,
    data: { levelNumber: number; levelName: string; targetMetric: number; pointsAward: number },
  ) {
    if (data.levelNumber < 1 || data.levelNumber > 4) {
      throw new BadRequestException('levelNumber must be between 1 and 4');
    }
    if (!data.levelName?.trim()) throw new BadRequestException('levelName is required');
    if (data.targetMetric <= 0) throw new BadRequestException('targetMetric must be a positive number');
    if (data.pointsAward < 0) throw new BadRequestException('pointsAward cannot be negative');

    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');

    const existingLevel = await this.prisma.gameLevel.findUnique({
      where: { gameId_levelNumber: { gameId, levelNumber: data.levelNumber } },
    });
    if (existingLevel) throw new BadRequestException(`This game already has a level ${data.levelNumber}`);

    return this.prisma.gameLevel.create({ data: { gameId, ...data, levelName: data.levelName.trim() } });
  }

  async updateGameLevel(levelId: string, data: Partial<{ levelName: string; targetMetric: number; pointsAward: number }>) {
    if (data.targetMetric !== undefined && data.targetMetric <= 0) {
      throw new BadRequestException('targetMetric must be a positive number');
    }
    if (data.pointsAward !== undefined && data.pointsAward < 0) {
      throw new BadRequestException('pointsAward cannot be negative');
    }
    return this.prisma.gameLevel.update({ where: { id: levelId }, data });
  }

  async deleteGameLevel(levelId: string) {
    return this.prisma.gameLevel.delete({ where: { id: levelId } });
  }

  private groupBy<T extends Record<string, any>>(rows: T[], keyOrFn: keyof T | ((row: T) => string)) {
    const getKey = typeof keyOrFn === 'function' ? keyOrFn : (row: T) => String(row[keyOrFn]);
    return rows.reduce((acc: Record<string, number>, row) => {
      const k = getKey(row);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
  }
}
