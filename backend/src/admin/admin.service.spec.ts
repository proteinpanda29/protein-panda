import { AdminService } from './admin.service';

function makeHarness() {
  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue([]), findUniqueOrThrow: jest.fn(), findUnique: jest.fn(), update: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _sum: { totalRs: 0 } }), count: jest.fn().mockResolvedValue(0) },
    payment: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    orderItem: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    deliveryPerson: { findUnique: jest.fn(), findMany: jest.fn() },
    deliveryOrder: { update: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    ingredient: { create: jest.fn(), findMany: jest.fn() },
    inventoryItem: { create: jest.fn(), update: jest.fn() },
    stockMovement: { create: jest.fn() },
    ingredientBatch: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    product: { update: jest.fn(), findUniqueOrThrow: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    customer: { count: jest.fn().mockResolvedValue(0), findUniqueOrThrow: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    pointsLedgerEntry: { aggregate: jest.fn().mockResolvedValue({ _sum: { points: 0 } }), findMany: jest.fn().mockResolvedValue([]) },
    user: { update: jest.fn().mockResolvedValue({}) },
    productCategory: { create: jest.fn(), update: jest.fn() },
    allergen: { findMany: jest.fn(), create: jest.fn() },
    productAllergen: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
    productAddon: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    productIngredient: { upsert: jest.fn(), delete: jest.fn() },
    reward: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    aiSafetyFlag: { findMany: jest.fn() },
    game: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    gameLevel: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    coupon: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn().mockImplementation((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  } as any;
  const orders = { grantOrderRewards: jest.fn().mockResolvedValue(undefined), notifyStatusChange: jest.fn().mockResolvedValue(undefined) } as any;
  const gateway = { emitOrderStatusUpdate: jest.fn() } as any;
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const businessDayLock = { assertNotClosed: jest.fn().mockResolvedValue(undefined), isTodayClosed: jest.fn().mockResolvedValue(false) } as any;
  const service = new AdminService(prisma, orders, gateway, auditLog, businessDayLock);
  return { service, prisma, gateway, orders, auditLog, businessDayLock };
}

describe('AdminService.getCustomerDetail — Customer 360', () => {
  function makeCustomerFixture(overrides: Partial<any> = {}) {
    return {
      id: 'cust-1',
      name: 'Rahul',
      memberships: [],
      ...overrides,
    };
  }

  it('computes real lifetime spend and average order value, excluding cancelled/failed orders', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue(makeCustomerFixture());
    prisma.order.aggregate.mockResolvedValue({ _sum: { totalRs: 18450 } });
    prisma.order.count.mockResolvedValue(37);

    const result = await service.getCustomerDetail('cust-1');

    expect(prisma.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'cust-1', status: { notIn: ['CANCELLED', 'FAILED'] } } }),
    );
    expect(result.totalSpendRs).toBe(18450);
    expect(result.totalOrderCount).toBe(37);
    expect(result.avgOrderValueRs).toBeCloseTo(498.6, 1);
  });

  it('returns an average order value of 0, not NaN or a crash, for a customer with no qualifying orders at all', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue(makeCustomerFixture());
    prisma.order.aggregate.mockResolvedValue({ _sum: { totalRs: null } });
    prisma.order.count.mockResolvedValue(0);

    const result = await service.getCustomerDetail('cust-1');

    expect(result.avgOrderValueRs).toBe(0);
    expect(result.totalSpendRs).toBe(0);
  });

  it('identifies the real favourite product — the one ordered in the highest total quantity', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue(makeCustomerFixture());
    prisma.orderItem.groupBy.mockResolvedValue([{ productId: 'prod-1', _sum: { quantity: 12 } }]);
    prisma.product.findUnique.mockResolvedValue({ id: 'prod-1', name: 'Chocolate Whey Shake' });

    const result = await service.getCustomerDetail('cust-1');

    expect(result.favouriteProduct).toEqual({ id: 'prod-1', name: 'Chocolate Whey Shake' });
  });

  it('returns null favourite product, not a crash, for a customer who has never ordered anything', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue(makeCustomerFixture());
    prisma.orderItem.groupBy.mockResolvedValue([]);

    const result = await service.getCustomerDetail('cust-1');

    expect(result.favouriteProduct).toBeNull();
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it('computes the real XP level from the full points ledger, same as the customer\'s own dashboard', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue(makeCustomerFixture());
    prisma.pointsLedgerEntry.aggregate.mockResolvedValue({ _sum: { points: 1250 } });

    const result = await service.getCustomerDetail('cust-1');

    expect(result.xpLevel).toBeDefined();
    expect(result.xpLevel.xp).toBe(1250);
  });

  it('surfaces the most recent membership only if it is genuinely still ACTIVE, not an expired/cancelled one', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue(makeCustomerFixture({ memberships: [{ id: 'mem-1', status: 'ACTIVE' }] }));

    const result = await service.getCustomerDetail('cust-1');

    expect(result.activeMembership).toEqual({ id: 'mem-1', status: 'ACTIVE' });
  });

  it('reports no active membership when the most recent one has expired or been cancelled', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue(makeCustomerFixture({ memberships: [{ id: 'mem-1', status: 'EXPIRED' }] }));

    const result = await service.getCustomerDetail('cust-1');

    expect(result.activeMembership).toBeNull();
  });
});

describe('AdminService.setCustomerActive', () => {
  it('blocks a customer by deactivating their underlying user account', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue({ id: 'cust-1', userId: 'user-1' });

    await service.setCustomerActive('cust-1', false);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { isActive: false } });
  });

  it('unblocks a customer by reactivating their underlying user account', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue({ id: 'cust-1', userId: 'user-1' });

    await service.setCustomerActive('cust-1', true);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { isActive: true } });
  });

  it('records a real audit log entry when an actor is given, naming the customer and the action taken', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue({ id: 'cust-1', userId: 'user-1', name: 'Ravi' });

    await service.setCustomerActive('cust-1', false, 'admin-user-1', 'ADMIN');

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user-1',
        action: 'CUSTOMER_BLOCKED',
        entityType: 'Customer',
        entityId: 'cust-1',
        summary: expect.stringContaining('Ravi'),
      }),
    );
  });

  it('does not attempt to log anything at all when no actor is given — e.g. an internal/system call', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.customer.findUniqueOrThrow.mockResolvedValue({ id: 'cust-1', userId: 'user-1', name: 'Ravi' });

    await service.setCustomerActive('cust-1', false);

    expect(auditLog.record).not.toHaveBeenCalled();
  });
});

describe('AdminService.getTodayOverview', () => {
  it('computes total sales as the sum of today\'s order totals', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany
      .mockResolvedValueOnce([{ totalRs: 149, status: 'DELIVERED', channel: 'APP', payment: { method: 'UPI' } }, { totalRs: 299, status: 'RECEIVED', channel: 'IN_STORE', payment: { method: 'CASH' } }])
      .mockResolvedValueOnce([]); // yesterday

    const result = await service.getTodayOverview();

    expect(result.totalSalesRs).toBe(448);
    expect(result.orderCount).toBe(2);
  });

  it('counts only RECEIVED/ACCEPTED/PREPARING orders as pending — READY/DELIVERED/CANCELLED are not actionable anymore', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany
      .mockResolvedValueOnce([
        { totalRs: 100, status: 'RECEIVED', channel: 'APP', payment: null },
        { totalRs: 100, status: 'ACCEPTED', channel: 'APP', payment: null },
        { totalRs: 100, status: 'PREPARING', channel: 'APP', payment: null },
        { totalRs: 100, status: 'READY', channel: 'APP', payment: null },
        { totalRs: 100, status: 'DELIVERED', channel: 'APP', payment: null },
        { totalRs: 100, status: 'CANCELLED', channel: 'APP', payment: null },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.getTodayOverview();

    expect(result.pendingOrderCount).toBe(3);
  });

  it('breaks down orders by payment method, ignoring orders with no payment record at all', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany
      .mockResolvedValueOnce([
        { totalRs: 100, status: 'DELIVERED', channel: 'APP', payment: { method: 'CASH' } },
        { totalRs: 100, status: 'DELIVERED', channel: 'APP', payment: { method: 'CASH' } },
        { totalRs: 100, status: 'DELIVERED', channel: 'APP', payment: { method: 'UPI' } },
        { totalRs: 100, status: 'DELIVERED', channel: 'APP', payment: null },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.getTodayOverview();

    expect(result.ordersByPaymentMethod).toEqual({ CASH: 2, UPI: 1 });
  });

  it('includes yesterday\'s totals for real comparison, not just an unlabelled single-day number', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany
      .mockResolvedValueOnce([{ totalRs: 500, status: 'DELIVERED', channel: 'APP', payment: null }])
      .mockResolvedValueOnce([{ totalRs: 200, status: 'DELIVERED', channel: 'APP', payment: null }, { totalRs: 100, status: 'DELIVERED', channel: 'APP', payment: null }]);

    const result = await service.getTodayOverview();

    expect(result.yesterdayTotalSalesRs).toBe(300);
    expect(result.yesterdayOrderCount).toBe(2);
  });

  it('queries yesterday as a distinct, non-overlapping window from today', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany.mockResolvedValue([]);

    await service.getTodayOverview();

    const todayCall = prisma.order.findMany.mock.calls[0][0];
    const yesterdayCall = prisma.order.findMany.mock.calls[1][0];
    expect(yesterdayCall.where.createdAt.lt).toEqual(todayCall.where.createdAt.gte);
  });
});

describe('AdminService.collectCashPayment', () => {
  it('rejects an order with no matching payment record', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUnique = jest.fn().mockResolvedValue(null);

    await expect(service.collectCashPayment('order-1')).rejects.toThrow(/not found/);
  });

  it('rejects a non-CASH order', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUnique = jest.fn().mockResolvedValue({
      id: 'order-1',
      payment: { id: 'pay-1', method: 'UPI', status: 'PAID' },
    });

    await expect(service.collectCashPayment('order-1')).rejects.toThrow(/not a cash payment/);
  });

  it('rejects an order already marked PAID — never grants rewards twice for the same collection', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.order.findUnique = jest.fn().mockResolvedValue({
      id: 'order-1',
      payment: { id: 'pay-1', method: 'CASH', status: 'PAID' },
    });
    orders.grantOrderRewards = jest.fn();

    await expect(service.collectCashPayment('order-1')).rejects.toThrow(/Already marked as paid/);
    expect(orders.grantOrderRewards).not.toHaveBeenCalled();
  });

  it('marks a pending cash payment PAID and grants rewards on collection', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.order.findUnique = jest.fn().mockResolvedValue({
      id: 'order-1',
      customerId: 'cust-1',
      totalProteinG: 30,
      totalRs: 149,
      payment: { id: 'pay-1', method: 'CASH', status: 'PENDING' },
    });
    orders.grantOrderRewards = jest.fn().mockResolvedValue(undefined);

    await service.collectCashPayment('order-1');

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
    expect(orders.grantOrderRewards).toHaveBeenCalledWith(expect.anything(), 'order-1', 'cust-1', 30, 149);
  });
});

describe('AdminService.getKitchenQueue', () => {
  it('only fetches active kitchen-relevant statuses — never delivered or cancelled orders', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany.mockResolvedValue([]);

    await service.getKitchenQueue();

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY'] } },
      }),
    );
  });

  it('orders oldest-first — first in, first cooked', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany.mockResolvedValue([]);

    await service.getKitchenQueue();

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
    );
  });

  it('includes item add-ons and the customer allergy list for the kitchen safety warning', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany.mockResolvedValue([]);

    await service.getKitchenQueue();

    const call = prisma.order.findMany.mock.calls[0][0];
    expect(call.include.customer.include.allergies).toBeDefined();
    expect(call.include.items.include.addons).toBeDefined();
  });
});

describe('AdminService.getPosAnalytics', () => {
  it('sums total sales and computes average order value', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany.mockResolvedValue([
      { id: 'o1', totalRs: 100, discountRs: 0, createdAt: new Date(), channel: 'WEBSITE' },
      { id: 'o2', totalRs: 200, discountRs: 0, createdAt: new Date(), channel: 'IN_STORE' },
    ]);

    const result = await service.getPosAnalytics('today');

    expect(result.totalSalesRs).toBe(300);
    expect(result.orderCount).toBe(2);
    expect(result.avgOrderValueRs).toBe(150);
  });

  it('returns zero average order value with no orders instead of dividing by zero', async () => {
    const { service } = makeHarness();
    const result = await service.getPosAnalytics('today');
    expect(result.avgOrderValueRs).toBe(0);
  });

  it('correctly separates new vs returning customers — returning means they ordered at least once before this window started', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany
      .mockResolvedValueOnce([
        { id: 'o1', customerId: 'cust-new', totalRs: 100, discountRs: 0, createdAt: new Date(), channel: 'WEBSITE' },
        { id: 'o2', customerId: 'cust-returning', totalRs: 200, discountRs: 0, createdAt: new Date(), channel: 'WEBSITE' },
      ])
      .mockResolvedValueOnce([{ customerId: 'cust-returning' }]); // only cust-returning has a prior order

    const result = await service.getPosAnalytics('today');

    expect(result.newCustomersCount).toBe(1);
    expect(result.returningCustomersCount).toBe(1);
    expect(result.retentionRatePct).toBe(50);
  });

  it('returns a 0% retention rate, not NaN, when nobody ordered in this window at all', async () => {
    const { service } = makeHarness();

    const result = await service.getPosAnalytics('today');

    expect(result.retentionRatePct).toBe(0);
    expect(result.newCustomersCount).toBe(0);
    expect(result.returningCustomersCount).toBe(0);
  });

  it('ranks top customers by real total spend in this window, with their real name attached', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany
      .mockResolvedValueOnce([
        { id: 'o1', customerId: 'cust-1', totalRs: 500, discountRs: 0, createdAt: new Date(), channel: 'WEBSITE' },
        { id: 'o2', customerId: 'cust-1', totalRs: 300, discountRs: 0, createdAt: new Date(), channel: 'WEBSITE' },
        { id: 'o3', customerId: 'cust-2', totalRs: 1000, discountRs: 0, createdAt: new Date(), channel: 'WEBSITE' },
      ])
      .mockResolvedValueOnce([]);
    prisma.customer.findMany.mockResolvedValue([
      { id: 'cust-1', name: 'Ravi' },
      { id: 'cust-2', name: 'Priya' },
    ]);

    const result = await service.getPosAnalytics('today');

    // cust-2 spent ₹1000 total (highest), cust-1 spent ₹800 total (500+300 combined)
    expect(result.topCustomers[0]).toEqual({ customerId: 'cust-2', name: 'Priya', totalRs: 1000 });
    expect(result.topCustomers[1]).toEqual({ customerId: 'cust-1', name: 'Ravi', totalRs: 800 });
  });

  it('sums discounts given across the range', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany.mockResolvedValue([
      { id: 'o1', totalRs: 100, discountRs: 20, createdAt: new Date(), channel: 'WEBSITE' },
      { id: 'o2', totalRs: 200, discountRs: 30, createdAt: new Date(), channel: 'WEBSITE' },
    ]);

    const result = await service.getPosAnalytics('today');
    expect(result.discountsGivenRs).toBe(50);
  });

  it('breaks down PAID payments by method', async () => {
    const { service, prisma } = makeHarness();
    prisma.payment.findMany.mockResolvedValue([
      { method: 'CASH', amountRs: 100 },
      { method: 'UPI', amountRs: 250 },
      { method: 'CASH', amountRs: 50 },
    ]);

    const result = await service.getPosAnalytics('today');
    expect(result.paymentBreakdown).toEqual({ CASH: 150, UPI: 250 });
  });

  it('buckets sales by hour only for the "today" range', async () => {
    const { service, prisma } = makeHarness();
    const nineAm = new Date();
    nineAm.setHours(9, 0, 0, 0);
    prisma.order.findMany.mockResolvedValue([
      { id: 'o1', totalRs: 100, discountRs: 0, createdAt: nineAm, channel: 'WEBSITE' },
    ]);

    const todayResult = await service.getPosAnalytics('today');
    expect(todayResult.hourlySales).not.toBeNull();
    expect(todayResult.hourlySales![9].totalRs).toBe(100);

    const weekResult = await service.getPosAnalytics('week');
    expect(weekResult.hourlySales).toBeNull();
  });

  it('ranks best-selling products by quantity sold, highest first', async () => {
    const { service, prisma } = makeHarness();
    prisma.orderItem.findMany.mockResolvedValue([
      { quantity: 5, product: { id: 'p1', name: 'Shake', isActive: true } },
      { quantity: 2, product: { id: 'p2', name: 'Oats', isActive: true } },
      { quantity: 3, product: { id: 'p1', name: 'Shake', isActive: true } },
    ]);

    const result = await service.getPosAnalytics('today');
    expect(result.bestSelling[0]).toEqual({ name: 'Shake', qty: 8 });
    expect(result.bestSelling[1]).toEqual({ name: 'Oats', qty: 2 });
  });

  it('excludes cancelled orders from every aggregate', async () => {
    const { service, prisma } = makeHarness();
    await service.getPosAnalytics('today');

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: 'CANCELLED' } }) }),
    );
  });

  it('splits sales into dine-in (IN_STORE) vs everything else as online', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany.mockResolvedValue([
      { id: 'o1', totalRs: 100, discountRs: 0, createdAt: new Date(), channel: 'IN_STORE' },
      { id: 'o2', totalRs: 200, discountRs: 0, createdAt: new Date(), channel: 'WEBSITE' },
      { id: 'o3', totalRs: 50, discountRs: 0, createdAt: new Date(), channel: 'MEMBERSHIP' },
    ]);

    const result = await service.getPosAnalytics('today');

    expect(result.dineInVsOnline).toEqual({ dineInRs: 100, dineInCount: 1, onlineRs: 250, onlineCount: 2 });
  });
});

describe('AdminService.listAvailableRiders — workload ranking', () => {
  it('ranks a rider with zero active deliveries ahead of one with an active delivery', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryPerson.findMany.mockResolvedValue([
      { id: 'rider-busy', name: 'Busy Rider' },
      { id: 'rider-free', name: 'Free Rider' },
    ]);
    prisma.deliveryOrder.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where.deliveryPersonId === 'rider-busy' ? 1 : 0),
    );
    prisma.deliveryOrder.findFirst.mockResolvedValue(null);

    const result = await service.listAvailableRiders();

    expect(result[0].id).toBe('rider-free');
    expect(result[1].id).toBe('rider-busy');
  });

  it('never claims a distance figure — only real, measurable signals are returned', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryPerson.findMany.mockResolvedValue([{ id: 'rider-1', name: 'Rider' }]);
    prisma.deliveryOrder.count.mockResolvedValue(0);
    prisma.deliveryOrder.findFirst.mockResolvedValue(null);

    const result = await service.listAvailableRiders();

    expect(result[0]).not.toHaveProperty('distanceKm');
    expect(result[0]).not.toHaveProperty('etaMinutes');
    expect(result[0]).toHaveProperty('activeDeliveries');
  });

  it('tie-breaks equal workload by longest idle time — the rider who delivered longest ago goes first', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryPerson.findMany.mockResolvedValue([
      { id: 'rider-recent', name: 'Recently Active' },
      { id: 'rider-idle', name: 'Long Idle' },
    ]);
    prisma.deliveryOrder.count.mockResolvedValue(0); // both equally free
    prisma.deliveryOrder.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.deliveryPersonId === 'rider-recent'
          ? { deliveredAt: new Date('2026-08-19T10:00:00Z') }
          : { deliveredAt: new Date('2026-08-01T10:00:00Z') },
      ),
    );

    const result = await service.listAvailableRiders();

    expect(result[0].id).toBe('rider-idle');
  });

  it('treats a rider who has never delivered as maximally idle (sorts first among equal workload)', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryPerson.findMany.mockResolvedValue([
      { id: 'rider-veteran', name: 'Veteran' },
      { id: 'rider-new', name: 'Brand New' },
    ]);
    prisma.deliveryOrder.count.mockResolvedValue(0);
    prisma.deliveryOrder.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.deliveryPersonId === 'rider-veteran' ? { deliveredAt: new Date() } : null),
    );

    const result = await service.listAvailableRiders();

    expect(result[0].id).toBe('rider-new');
  });
});

describe('AdminService.suggestBestRider', () => {
  it('returns null when no riders are on duty', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryPerson.findMany.mockResolvedValue([]);

    await expect(service.suggestBestRider()).resolves.toBeNull();
  });

  it('returns the top-ranked rider', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryPerson.findMany.mockResolvedValue([{ id: 'rider-1', name: 'Only Rider' }]);
    prisma.deliveryOrder.count.mockResolvedValue(0);
    prisma.deliveryOrder.findFirst.mockResolvedValue(null);

    const result = await service.suggestBestRider();

    expect(result?.id).toBe('rider-1');
  });
});

describe('AdminService.autoAssignBestRider', () => {
  it('rejects when no rider is on duty', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryPerson.findMany.mockResolvedValue([]);

    await expect(service.autoAssignBestRider('order-1')).rejects.toThrow(/No riders are currently on duty/);
  });

  it('assigns the top-ranked rider to the order', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryPerson.findMany.mockResolvedValue([{ id: 'rider-best', name: 'Best Rider', isOnDuty: true }]);
    prisma.deliveryOrder.count.mockResolvedValue(0);
    prisma.deliveryOrder.findFirst.mockResolvedValue(null);
    prisma.deliveryPerson.findUnique.mockResolvedValue({ id: 'rider-best', isOnDuty: true });
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 'order-1', deliveryOrder: { id: 'do-1' } });
    prisma.deliveryOrder.update.mockResolvedValue({ id: 'do-1' });
    prisma.order.update.mockResolvedValue({ id: 'order-1', orderNumber: 'PP1234', status: 'ASSIGNED', customerId: 'cust-1' });

    await service.autoAssignBestRider('order-1');

    expect(prisma.deliveryOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deliveryPersonId: 'rider-best' }) }),
    );
  });
});

describe('AdminService.assignDeliveryRider', () => {
  it('refuses to assign a rider who is not on duty', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 'order-1', deliveryOrder: { id: 'do-1' } });
    prisma.deliveryPerson.findUnique.mockResolvedValue({ id: 'rider-1', isOnDuty: false });

    await expect(service.assignDeliveryRider('order-1', 'rider-1')).rejects.toThrow(/not currently on duty/);
  });

  it('refuses to assign a rider to an order that has no DeliveryOrder record (i.e. a pickup order)', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 'order-1', deliveryOrder: null });

    await expect(service.assignDeliveryRider('order-1', 'rider-1')).rejects.toThrow(/not a delivery order/);
  });

  it('assigns the rider, sets the order status to ASSIGNED, and broadcasts the update', async () => {
    const { service, prisma, gateway } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 'order-1', deliveryOrder: { id: 'do-1' } });
    prisma.deliveryPerson.findUnique.mockResolvedValue({ id: 'rider-1', isOnDuty: true });
    prisma.deliveryOrder.update.mockResolvedValue({ id: 'do-1', deliveryPersonId: 'rider-1' });
    prisma.order.update.mockResolvedValue({ id: 'order-1', orderNumber: 'PP1234', status: 'ASSIGNED', customerId: 'cust-1' });

    await service.assignDeliveryRider('order-1', 'rider-1');

    expect(prisma.deliveryOrder.update).toHaveBeenCalledWith({
      where: { id: 'do-1' },
      data: { deliveryPersonId: 'rider-1', assignedAt: expect.any(Date) },
    });
    expect(gateway.emitOrderStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', status: 'ASSIGNED', deliveryPersonId: 'rider-1' }),
    );
  });

  it('notifies the customer with the real rider\'s name — the exact "X is your delivery partner" moment', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 'order-1', deliveryOrder: { id: 'do-1' } });
    prisma.deliveryPerson.findUnique.mockResolvedValue({ id: 'rider-1', isOnDuty: true, name: 'Lathif' });
    prisma.deliveryOrder.update.mockResolvedValue({ id: 'do-1', deliveryPersonId: 'rider-1' });
    prisma.order.update.mockResolvedValue({ id: 'order-1', orderNumber: 'PP1234', status: 'ASSIGNED', customerId: 'cust-1' });

    await service.assignDeliveryRider('order-1', 'rider-1');

    expect(orders.notifyStatusChange).toHaveBeenCalledWith('order-1', 'ASSIGNED', 'Lathif');
  });
});

describe('AdminService.createIngredient', () => {
  it('creates the ingredient and its starting inventory record together', async () => {
    const { service, prisma } = makeHarness();
    prisma.ingredient.create.mockResolvedValue({ id: 'ing-1', name: 'Peanut Butter' });
    prisma.inventoryItem.create.mockResolvedValue({ id: 'inv-1' });

    await service.createIngredient({ name: 'Peanut Butter', unit: 'g', initialQuantity: 2000, reorderLevel: 500 });

    expect(prisma.ingredient.create).toHaveBeenCalledWith({ data: { name: 'Peanut Butter', unit: 'g' } });
    expect(prisma.inventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ingredientId: 'ing-1', quantityOnHand: 2000, reorderLevel: 500 } }),
    );
  });

  it('also creates an initial batch when starting quantity is positive', async () => {
    const { service, prisma } = makeHarness();
    prisma.ingredient.create.mockResolvedValue({ id: 'ing-1' });
    prisma.inventoryItem.create.mockResolvedValue({ id: 'inv-1' });

    await service.createIngredient({
      name: 'Peanut Butter',
      unit: 'g',
      initialQuantity: 2000,
      reorderLevel: 500,
      batchNumber: 'PB-001',
      expiryDate: '2026-12-01',
      supplierName: 'ABC Traders',
    });

    expect(prisma.ingredientBatch.create).toHaveBeenCalledWith({
      data: {
        ingredientId: 'ing-1',
        batchNumber: 'PB-001',
        supplierName: 'ABC Traders',
        quantityReceived: 2000,
        quantityRemaining: 2000,
        expiryDate: new Date('2026-12-01'),
      },
    });
  });

  it('skips creating a batch when starting quantity is zero', async () => {
    const { service, prisma } = makeHarness();
    prisma.ingredient.create.mockResolvedValue({ id: 'ing-1' });
    prisma.inventoryItem.create.mockResolvedValue({ id: 'inv-1' });

    await service.createIngredient({ name: 'New Item', unit: 'g', initialQuantity: 0, reorderLevel: 100 });

    expect(prisma.ingredientBatch.create).not.toHaveBeenCalled();
  });

  it('auto-generates a batch number when none is given', async () => {
    const { service, prisma } = makeHarness();
    prisma.ingredient.create.mockResolvedValue({ id: 'ing-1' });
    prisma.inventoryItem.create.mockResolvedValue({ id: 'inv-1' });

    await service.createIngredient({ name: 'X', unit: 'g', initialQuantity: 100, reorderLevel: 20 });

    expect(prisma.ingredientBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ batchNumber: expect.stringContaining('INIT-') }) }),
    );
  });
});

describe('AdminService.restock', () => {
  it('rejects a zero-amount restock', async () => {
    const { service } = makeHarness();
    await expect(service.restock('inv-1', 0)).rejects.toThrow(/non-zero/);
  });

  it('logs a positive amount as RESTOCK', async () => {
    const { service, prisma } = makeHarness();
    prisma.inventoryItem.update.mockResolvedValue({ ingredientId: 'ing-1' });

    await service.restock('inv-1', 500, 'Delivery from supplier');

    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: { inventoryItemId: 'inv-1', type: 'RESTOCK', quantity: 500, note: 'Delivery from supplier' },
    });
  });

  it('logs a negative amount as ADJUSTMENT', async () => {
    const { service, prisma } = makeHarness();
    prisma.inventoryItem.update.mockResolvedValue({ ingredientId: 'ing-1' });

    await service.restock('inv-1', -50);

    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'ADJUSTMENT', quantity: -50 }) }),
    );
  });

  it('creates a new batch for a positive restock, with optional batch/expiry/supplier details', async () => {
    const { service, prisma } = makeHarness();
    prisma.inventoryItem.update.mockResolvedValue({ ingredientId: 'ing-1' });

    await service.restock('inv-1', 500, 'Delivery from supplier', {
      batchNumber: 'MILK-042',
      expiryDate: '2026-08-25',
      supplierName: 'Local Dairy',
    });

    expect(prisma.ingredientBatch.create).toHaveBeenCalledWith({
      data: {
        ingredientId: 'ing-1',
        batchNumber: 'MILK-042',
        supplierName: 'Local Dairy',
        quantityReceived: 500,
        quantityRemaining: 500,
        expiryDate: new Date('2026-08-25'),
      },
    });
  });

  it('does NOT create a batch for a negative correction — corrections are aggregate-only', async () => {
    const { service, prisma } = makeHarness();
    prisma.inventoryItem.update.mockResolvedValue({ ingredientId: 'ing-1' });

    await service.restock('inv-1', -50, 'Miscount correction');

    expect(prisma.ingredientBatch.create).not.toHaveBeenCalled();
  });
});

describe('AdminService.recordWastage', () => {
  it('rejects a non-positive quantity', async () => {
    const { service } = makeHarness();
    await expect(service.recordWastage('batch-1', 0, 'spoiled')).rejects.toThrow(/positive/);
  });

  it('rejects a missing reason', async () => {
    const { service } = makeHarness();
    await expect(service.recordWastage('batch-1', 5, '')).rejects.toThrow(/reason is required/);
  });

  it('rejects wasting more than the batch has remaining', async () => {
    const { service, prisma } = makeHarness();
    prisma.ingredientBatch.findUniqueOrThrow.mockResolvedValue({
      id: 'batch-1',
      quantityRemaining: 10,
      ingredient: { stock: { id: 'inv-1' } },
    });

    await expect(service.recordWastage('batch-1', 20, 'spoiled')).rejects.toThrow(/remaining in this batch/);
  });

  it('rejects when the ingredient has no inventory record', async () => {
    const { service, prisma } = makeHarness();
    prisma.ingredientBatch.findUniqueOrThrow.mockResolvedValue({
      id: 'batch-1',
      quantityRemaining: 10,
      ingredient: { stock: null },
    });

    await expect(service.recordWastage('batch-1', 5, 'spoiled')).rejects.toThrow(/No inventory record/);
  });

  it('decrements both the batch and the aggregate total, logging a WASTAGE movement', async () => {
    const { service, prisma } = makeHarness();
    prisma.ingredientBatch.findUniqueOrThrow.mockResolvedValue({
      id: 'batch-1',
      quantityRemaining: 10,
      ingredient: { stock: { id: 'inv-1' } },
    });

    await service.recordWastage('batch-1', 4, 'Spoiled — left out overnight');

    expect(prisma.ingredientBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { quantityRemaining: { decrement: 4 } },
    });
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { quantityOnHand: { decrement: 4 } },
    });
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: { inventoryItemId: 'inv-1', batchId: 'batch-1', type: 'WASTAGE', quantity: -4, note: 'Spoiled — left out overnight' },
    });
  });
});

describe('AdminService.listExpiringBatches', () => {
  it('only returns batches with stock remaining and an expiry within the threshold', async () => {
    const { service, prisma } = makeHarness();
    prisma.ingredientBatch.findMany.mockResolvedValue([]);

    await service.listExpiringBatches(3);

    expect(prisma.ingredientBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { quantityRemaining: { gt: 0 }, expiryDate: { not: null, lte: expect.any(Date) } },
        orderBy: { expiryDate: 'asc' },
      }),
    );
  });

  it('defaults to a 3-day lookahead when not specified', async () => {
    const { service, prisma } = makeHarness();
    prisma.ingredientBatch.findMany.mockResolvedValue([]);

    await service.listExpiringBatches();

    const call = prisma.ingredientBatch.findMany.mock.calls[0][0];
    const daysUntilThreshold = Math.round((call.where.expiryDate.lte.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    expect(daysUntilThreshold).toBe(3);
  });
});

describe('AdminService.updateProduct', () => {
  it('upserts nutrition alongside plain field updates in one call', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.update.mockResolvedValue({});

    await service.updateProduct('prod-1', {
      name: 'New Name',
      nutrition: { calories: 300, proteinG: 25, carbsG: 10, fatG: 5, fibreG: 2 },
    });

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: {
        name: 'New Name',
        nutrition: {
          upsert: {
            create: { calories: 300, proteinG: 25, carbsG: 10, fatG: 5, fibreG: 2 },
            update: { calories: 300, proteinG: 25, carbsG: 10, fatG: 5, fibreG: 2 },
          },
        },
      },
      include: { nutrition: true, category: true },
    });
  });

  it('passes prepTimeMinutes through as a plain field update', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.update.mockResolvedValue({});

    await service.updateProduct('prod-1', { prepTimeMinutes: 12 });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { prepTimeMinutes: 12 } }),
    );
  });

  it('can flip isActive to mark a product out of stock', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.update.mockResolvedValue({});

    await service.updateProduct('prod-1', { isActive: false });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it('does not touch nutrition when none is provided', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.update.mockResolvedValue({});

    await service.updateProduct('prod-1', { isActive: false });

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it('passes calcium/iron/potassium through alongside the core nutrition fields — previously silently dropped, since the type signature never accepted them even though the database always supported them', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.update.mockResolvedValue({});

    await service.updateProduct('prod-1', {
      nutrition: { calories: 300, proteinG: 25, carbsG: 10, fatG: 5, fibreG: 2, calciumMg: 120, ironMg: 2, potassiumMg: 350 },
    });

    const call = prisma.product.update.mock.calls[0][0];
    expect(call.data.nutrition.upsert.create).toEqual(
      expect.objectContaining({ calciumMg: 120, ironMg: 2, potassiumMg: 350 }),
    );
  });

  it('records a real audit log entry when the price actually changes, with the exact before/after values', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.product.findUnique.mockResolvedValue({ basePriceRs: 180, name: 'Chocolate Shake' });
    prisma.product.update.mockResolvedValue({ id: 'prod-1', name: 'Chocolate Shake' });

    await service.updateProduct('prod-1', { basePriceRs: 220 }, 'admin-user-1', 'ADMIN');

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user-1',
        action: 'PRODUCT_PRICE_CHANGED',
        entityType: 'Product',
        entityId: 'prod-1',
        summary: expect.stringContaining('₹180 to ₹220'),
        metadata: { from: 180, to: 220 },
      }),
    );
  });

  it('does not log anything when the price field was not actually part of this update', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.product.update.mockResolvedValue({ id: 'prod-1', name: 'Chocolate Shake' });

    await service.updateProduct('prod-1', { name: 'New Name' }, 'admin-user-1', 'ADMIN');

    expect(auditLog.record).not.toHaveBeenCalled();
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it('does not log anything (or even look up the old price) when no actor is given at all', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.product.update.mockResolvedValue({ id: 'prod-1', name: 'Chocolate Shake' });

    await service.updateProduct('prod-1', { basePriceRs: 220 });

    expect(auditLog.record).not.toHaveBeenCalled();
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it('does not log anything when the "new" price is actually the same as the old one', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.product.findUnique.mockResolvedValue({ basePriceRs: 180, name: 'Chocolate Shake' });
    prisma.product.update.mockResolvedValue({ id: 'prod-1', name: 'Chocolate Shake' });

    await service.updateProduct('prod-1', { basePriceRs: 180 }, 'admin-user-1', 'ADMIN');

    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('refuses a price change once today\'s business day has been closed', async () => {
    const { service, businessDayLock } = makeHarness();
    businessDayLock.assertNotClosed.mockRejectedValue(new Error("Today's business day has been closed"));

    await expect(service.updateProduct('prod-1', { basePriceRs: 220 }, 'admin-user-1', 'ADMIN')).rejects.toThrow(/business day has been closed/);
  });

  it('never even checks the business day lock for a non-price edit (e.g. renaming a product)', async () => {
    const { service, prisma, businessDayLock } = makeHarness();
    prisma.product.update.mockResolvedValue({ id: 'prod-1', name: 'New Name' });

    await service.updateProduct('prod-1', { name: 'New Name' }, 'admin-user-1', 'ADMIN');

    expect(businessDayLock.assertNotClosed).not.toHaveBeenCalled();
  });
});

describe('AdminService.setProductAllergens', () => {
  it('replaces the full allergen set atomically (delete then recreate)', async () => {
    const { service, prisma } = makeHarness();
    prisma.productAllergen.findMany.mockResolvedValue([]);

    await service.setProductAllergens('prod-1', ['allergen-milk', 'allergen-egg']);

    expect(prisma.productAllergen.deleteMany).toHaveBeenCalledWith({ where: { productId: 'prod-1' } });
    expect(prisma.productAllergen.createMany).toHaveBeenCalledWith({
      data: [
        { productId: 'prod-1', allergenId: 'allergen-milk' },
        { productId: 'prod-1', allergenId: 'allergen-egg' },
      ],
    });
  });
});

describe('AdminService addon management', () => {
  it('defaults isRequired to false and extraPriceRs to 0 when creating an addon', async () => {
    const { service, prisma } = makeHarness();
    prisma.productAddon.create.mockResolvedValue({});

    await service.createProductAddon('prod-1', { group: 'ADDON', name: 'Banana' });

    expect(prisma.productAddon.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: 'prod-1', group: 'ADDON', name: 'Banana', isRequired: false, extraPriceRs: 0 }),
    });
  });

  it('deletes an addon by id', async () => {
    const { service, prisma } = makeHarness();
    prisma.productAddon.delete.mockResolvedValue({});

    await service.deleteProductAddon('addon-1');

    expect(prisma.productAddon.delete).toHaveBeenCalledWith({ where: { id: 'addon-1' } });
  });
});

describe('AdminService recipe management', () => {
  it('upserts a product-ingredient recipe line', async () => {
    const { service, prisma } = makeHarness();
    prisma.productIngredient.upsert.mockResolvedValue({});

    await service.setProductIngredient('prod-1', 'ing-1', 30);

    expect(prisma.productIngredient.upsert).toHaveBeenCalledWith({
      where: { productId_ingredientId: { productId: 'prod-1', ingredientId: 'ing-1' } },
      create: { productId: 'prod-1', ingredientId: 'ing-1', quantity: 30 },
      update: { quantity: 30 },
    });
  });

  it('removes a recipe line', async () => {
    const { service, prisma } = makeHarness();
    prisma.productIngredient.delete.mockResolvedValue({});

    await service.removeProductIngredient('prod-1', 'ing-1');

    expect(prisma.productIngredient.delete).toHaveBeenCalledWith({
      where: { productId_ingredientId: { productId: 'prod-1', ingredientId: 'ing-1' } },
    });
  });
});

describe('AdminService.createReward', () => {
  it('creates a reward with the given fields', async () => {
    const { service, prisma } = makeHarness();
    prisma.reward.create.mockResolvedValue({});

    await service.createReward({ name: 'Free Add-on', type: 'FREE_ADDON', pointsCost: 100 });

    expect(prisma.reward.create).toHaveBeenCalledWith({
      data: { name: 'Free Add-on', description: undefined, type: 'FREE_ADDON', pointsCost: 100, valueRs: undefined },
    });
  });
});

describe('AdminService.createCoupon', () => {
  it('rejects a coupon with neither a flat nor percentage discount', async () => {
    const { service } = makeHarness();
    await expect(
      service.createCoupon({ code: 'BAD', validFrom: '2026-01-01', validUntil: '2026-02-01' }),
    ).rejects.toThrow(/flat discount|percentage/);
  });

  it('uppercases and trims the coupon code', async () => {
    const { service, prisma } = makeHarness();
    prisma.coupon.create.mockResolvedValue({});

    await service.createCoupon({ code: '  save10 ', discountPct: 10, validFrom: '2026-01-01', validUntil: '2026-02-01' });

    expect(prisma.coupon.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'SAVE10' }) }),
    );
  });

  it('converts date strings to Date objects', async () => {
    const { service, prisma } = makeHarness();
    prisma.coupon.create.mockResolvedValue({});

    await service.createCoupon({ code: 'X', discountRs: 20, validFrom: '2026-01-01', validUntil: '2026-02-01' });

    const call = prisma.coupon.create.mock.calls[0][0];
    expect(call.data.validFrom).toBeInstanceOf(Date);
    expect(call.data.validUntil).toBeInstanceOf(Date);
  });
});

describe('AdminService.updateCoupon', () => {
  it('converts validUntil to a Date when provided', async () => {
    const { service, prisma } = makeHarness();
    prisma.coupon.update.mockResolvedValue({});

    await service.updateCoupon('coupon-1', { validUntil: '2026-03-01', isActive: false });

    const call = prisma.coupon.update.mock.calls[0][0];
    expect(call.data.validUntil).toBeInstanceOf(Date);
    expect(call.data.isActive).toBe(false);
  });

  it('leaves validUntil untouched when not provided', async () => {
    const { service, prisma } = makeHarness();
    prisma.coupon.update.mockResolvedValue({});

    await service.updateCoupon('coupon-1', { isActive: false });

    expect(prisma.coupon.update).toHaveBeenCalledWith({ where: { id: 'coupon-1' }, data: { isActive: false } });
  });
});

describe('AdminService.createGame', () => {
  it('rejects a missing name', async () => {
    const { service } = makeHarness();
    await expect(service.createGame({ name: '' })).rejects.toThrow(/name is required/);
  });

  it('refuses a duplicate game name', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findUnique.mockResolvedValue({ id: 'game-1' });

    await expect(service.createGame({ name: 'Hanging Challenge' })).rejects.toThrow(/already exists/);
  });

  it('creates a game with a trimmed name', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findUnique.mockResolvedValue(null);
    prisma.game.create.mockResolvedValue({});

    await service.createGame({ name: '  Plank Challenge  ', description: 'Hold as long as you can' });

    expect(prisma.game.create).toHaveBeenCalledWith({
      data: { name: 'Plank Challenge', description: 'Hold as long as you can' },
    });
  });
});

describe('AdminService.createGameLevel', () => {
  const validLevel = { levelNumber: 1, levelName: 'Beginner', targetMetric: 30, pointsAward: 50 };

  it('rejects a levelNumber outside 1-4', async () => {
    const { service } = makeHarness();
    await expect(service.createGameLevel('game-1', { ...validLevel, levelNumber: 5 })).rejects.toThrow(
      /between 1 and 4/,
    );
  });

  it('rejects a missing levelName', async () => {
    const { service } = makeHarness();
    await expect(service.createGameLevel('game-1', { ...validLevel, levelName: '' })).rejects.toThrow(
      /levelName is required/,
    );
  });

  it('rejects a zero or negative targetMetric', async () => {
    const { service } = makeHarness();
    await expect(service.createGameLevel('game-1', { ...validLevel, targetMetric: 0 })).rejects.toThrow(
      /positive number/,
    );
  });

  it('rejects a negative pointsAward', async () => {
    const { service } = makeHarness();
    await expect(service.createGameLevel('game-1', { ...validLevel, pointsAward: -10 })).rejects.toThrow(
      /cannot be negative/,
    );
  });

  it('rejects a level for a game that does not exist', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findUnique.mockResolvedValue(null);

    await expect(service.createGameLevel('game-MISSING', validLevel)).rejects.toThrow(/Game not found/);
  });

  it('refuses a duplicate levelNumber for the same game', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findUnique.mockResolvedValue({ id: 'game-1' });
    prisma.gameLevel.findUnique.mockResolvedValue({ id: 'level-existing' });

    await expect(service.createGameLevel('game-1', validLevel)).rejects.toThrow(/already has a level 1/);
  });

  it('creates the level with a trimmed name once all checks pass', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findUnique.mockResolvedValue({ id: 'game-1' });
    prisma.gameLevel.findUnique.mockResolvedValue(null);
    prisma.gameLevel.create.mockResolvedValue({});

    await service.createGameLevel('game-1', { ...validLevel, levelName: '  Beginner  ' });

    expect(prisma.gameLevel.create).toHaveBeenCalledWith({
      data: { gameId: 'game-1', ...validLevel, levelName: 'Beginner' },
    });
  });
});

describe('AdminService.updateGameLevel', () => {
  it('rejects updating targetMetric to zero or negative', async () => {
    const { service } = makeHarness();
    await expect(service.updateGameLevel('level-1', { targetMetric: -5 })).rejects.toThrow(/positive number/);
  });

  it('rejects updating pointsAward to negative', async () => {
    const { service } = makeHarness();
    await expect(service.updateGameLevel('level-1', { pointsAward: -1 })).rejects.toThrow(/cannot be negative/);
  });

  it('allows a partial update of just levelName', async () => {
    const { service, prisma } = makeHarness();
    prisma.gameLevel.update.mockResolvedValue({});

    await service.updateGameLevel('level-1', { levelName: 'Advanced' });

    expect(prisma.gameLevel.update).toHaveBeenCalledWith({ where: { id: 'level-1' }, data: { levelName: 'Advanced' } });
  });
});

describe('AdminService.deleteGameLevel', () => {
  it('deletes the level by id', async () => {
    const { service, prisma } = makeHarness();
    prisma.gameLevel.delete.mockResolvedValue({});

    await service.deleteGameLevel('level-1');

    expect(prisma.gameLevel.delete).toHaveBeenCalledWith({ where: { id: 'level-1' } });
  });
});

describe('AdminService.listGames (admin view)', () => {
  it('includes inactive games and orders levels by levelNumber', async () => {
    const { service, prisma } = makeHarness();
    prisma.game.findMany.mockResolvedValue([]);

    await service.listGames();

    expect(prisma.game.findMany).toHaveBeenCalledWith({
      orderBy: { name: 'asc' },
      include: { levels: { orderBy: { levelNumber: 'asc' } } },
    });
  });
});

describe('AdminService.getProductCosting', () => {
  it('computes food cost as the sum of recipe quantity × ingredient cost', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.findUniqueOrThrow.mockResolvedValue({
      id: 'prod-1',
      name: 'Chocolate Shake',
      basePriceRs: 149,
      packagingCostRs: 5,
      ingredients: [
        { quantity: 30, ingredient: { name: 'Whey', unit: 'g', costPerUnitRs: 1.5 } }, // 45
        { quantity: 200, ingredient: { name: 'Milk', unit: 'ml', costPerUnitRs: 0.06 } }, // 12
      ],
    });

    const result = await service.getProductCosting('prod-1');

    expect(result.foodCostRs).toBeCloseTo(57, 5);
    expect(result.packagingCostRs).toBe(5);
    expect(result.totalCostRs).toBeCloseTo(62, 5);
    expect(result.grossMarginRs).toBeCloseTo(87, 5);
  });

  it('computes gross margin percentage against the selling price', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.findUniqueOrThrow.mockResolvedValue({
      id: 'prod-1',
      name: 'X',
      basePriceRs: 100,
      packagingCostRs: null,
      ingredients: [{ quantity: 1, ingredient: { name: 'A', unit: 'g', costPerUnitRs: 40 } }],
    });

    const result = await service.getProductCosting('prod-1');

    expect(result.grossMarginPct).toBeCloseTo(60, 5);
  });

  it('flags hasUnknownCosts when an ingredient has never had a purchase recorded', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.findUniqueOrThrow.mockResolvedValue({
      id: 'prod-1',
      name: 'X',
      basePriceRs: 100,
      packagingCostRs: null,
      ingredients: [{ quantity: 1, ingredient: { name: 'Mystery Item', unit: 'g', costPerUnitRs: null } }],
    });

    const result = await service.getProductCosting('prod-1');

    expect(result.hasUnknownCosts).toBe(true);
    expect(result.foodCostRs).toBe(0); // unknown cost treated as 0, not silently guessed
  });

  it('flags hasNoRecipe when the product has zero linked ingredients', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.findUniqueOrThrow.mockResolvedValue({
      id: 'prod-1',
      name: 'X',
      basePriceRs: 100,
      packagingCostRs: null,
      ingredients: [],
    });

    const result = await service.getProductCosting('prod-1');

    expect(result.hasNoRecipe).toBe(true);
  });
});

describe('AdminService.listProductCostingSummary', () => {
  it('sorts products by gross margin percentage, worst first', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', name: 'High Margin', basePriceRs: 200, packagingCostRs: null, ingredients: [{ quantity: 1, ingredient: { costPerUnitRs: 20 } }] }, // 90% margin
      { id: 'p2', name: 'Low Margin', basePriceRs: 100, packagingCostRs: null, ingredients: [{ quantity: 1, ingredient: { costPerUnitRs: 90 } }] }, // 10% margin
    ]);

    const result = await service.listProductCostingSummary();

    expect(result[0].name).toBe('Low Margin');
    expect(result[1].name).toBe('High Margin');
  });

  it('treats products with no purchase history as zero food cost, not an error', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', name: 'New Item', basePriceRs: 100, packagingCostRs: null, ingredients: [{ quantity: 1, ingredient: { costPerUnitRs: null } }] },
    ]);

    const result = await service.listProductCostingSummary();

    expect(result[0].totalCostRs).toBe(0);
    expect(result[0].grossMarginPct).toBe(100);
  });

  it('only considers active products', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.findMany.mockResolvedValue([]);

    await service.listProductCostingSummary();

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });
});

describe('AdminService.listAiSafetyFlags', () => {
  it('returns recent flags ordered newest-first with the customer name attached', async () => {
    const { service, prisma } = makeHarness();
    prisma.aiSafetyFlag.findMany.mockResolvedValue([]);

    await service.listAiSafetyFlags();

    expect(prisma.aiSafetyFlag.findMany).toHaveBeenCalledWith({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true } } },
    });
  });
});
