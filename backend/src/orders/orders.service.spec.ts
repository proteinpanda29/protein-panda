import { BadRequestException } from '@nestjs/common';
import { PointsSourceType } from '@prisma/client';
import { OrdersService } from './orders.service';

function makeProduct(overrides: Partial<any> = {}) {
  return {
    id: 'prod-shake',
    name: 'Custom Protein Shake',
    isActive: true,
    basePriceRs: 149,
    nutrition: { proteinG: 30, calories: 320 },
    allergens: [],
    addonOptions: [
      { id: 'base-whey', group: 'BASE', isRequired: true, extraPriceRs: 0, extraProteinG: 24, extraCalories: 120 },
      { id: 'flavour-choc', group: 'FLAVOUR', isRequired: true, extraPriceRs: 0, extraProteinG: 0, extraCalories: 0 },
      { id: 'liquid-milk', group: 'LIQUID', isRequired: true, extraPriceRs: 0, extraProteinG: 0, extraCalories: 60 },
      { id: 'addon-banana', group: 'ADDON', isRequired: false, extraPriceRs: 15, extraProteinG: 1, extraCalories: 100 },
    ],
    ...overrides,
  };
}

function makeCustomer(allergyNames: string[] = []) {
  return {
    id: 'cust-1',
    allergies: allergyNames.map((name) => ({ allergen: { name } })),
  };
}

/** Builds a fake Prisma tx object and wires $transaction to invoke the callback with it. */
function makeHarness(opts: { product?: any; customer?: any; activeGoal?: any } = {}) {
  const product = opts.product ?? makeProduct();
  const customer = opts.customer ?? makeCustomer();

  const tx = {
    customer: { findUniqueOrThrow: jest.fn().mockResolvedValue(customer), findUnique: jest.fn().mockResolvedValue(customer), update: jest.fn().mockResolvedValue({}) },
    product: { findUniqueOrThrow: jest.fn().mockResolvedValue(product) },
    coupon: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    rewardRedemption: { findUniqueOrThrow: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    order: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'order-1', orderNumber: 'PP1234', sequenceNumber: 1234, status: 'RECEIVED', ...data }),
      ),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
    deliveryOrder: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    nutritionLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    proteinGoalRun: {
      findFirst: jest.fn().mockResolvedValue(opts.activeGoal ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;

  const prisma = {
    $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
    order: { findUnique: jest.fn().mockResolvedValue(null), findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    deliveryRating: { aggregate: jest.fn().mockResolvedValue({ _avg: { rating: null } }) },
    deliveryOrder: { count: jest.fn().mockResolvedValue(0), update: jest.fn().mockResolvedValue({}) },
  } as any;
  const points = { award: jest.fn().mockResolvedValue(undefined) } as any;
  const streaks = { recordQualifyingActivity: jest.fn().mockResolvedValue({ currentStreakDays: 1 }) } as any;
  const attendance = { recordVisit: jest.fn().mockResolvedValue({}), getMonthlyProgress: jest.fn().mockResolvedValue({}) } as any;
  const gateway = { emitOrderStatusUpdate: jest.fn() } as any;
  const achievements = {
    checkOrderAchievements: jest.fn().mockResolvedValue(undefined),
    checkStreakAchievements: jest.fn().mockResolvedValue(undefined),
    checkDailyProteinAchievement: jest.fn().mockResolvedValue(undefined),
  } as any;
  const shop = { isOpen: jest.fn().mockResolvedValue(true), isPincodeServiceable: jest.fn().mockResolvedValue(true), quoteDeliveryFee: jest.fn().mockResolvedValue(null) } as any;
  const invoices = { sendInvoiceEmail: jest.fn().mockResolvedValue(undefined) } as any;
  const notificationQueue = { queueInvoiceEmail: jest.fn().mockResolvedValue(undefined) } as any;
  const notificationCenter = { notifyCustomer: jest.fn().mockResolvedValue(undefined) } as any;
  const inventory = { deductForOrder: jest.fn().mockResolvedValue(undefined) } as any;

  const wallet = { debit: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new OrdersService(prisma, points, streaks, attendance, gateway, achievements, shop, notificationQueue, inventory, notificationCenter, wallet);
  return { service, tx, prisma, points, streaks, attendance, gateway, shop, invoices, notificationQueue, notificationCenter, inventory, wallet };
}

describe('OrdersService.create', () => {
  const baseInput = {
    customerId: 'cust-1',
    channel: 'WEBSITE' as const,
    fulfillmentType: 'PICKUP' as const,
    paymentMethod: 'CASH' as const,
    items: [{ productId: 'prod-shake', quantity: 1, addonIds: ['base-whey', 'flavour-choc', 'liquid-milk'] }],
  };

  it('rejects an order with no items', async () => {
    const { service } = makeHarness();
    await expect(service.create({ ...baseInput, items: [] })).rejects.toThrow(BadRequestException);
  });

  it('rejects a delivery order missing an address or contact phone', async () => {
    const { service } = makeHarness();
    await expect(
      service.create({ ...baseInput, fulfillmentType: 'DELIVERY' as any }),
    ).rejects.toThrow(/address and contact phone/);
  });

  it('rejects a delivery order to a pincode outside the configured serviceable list', async () => {
    const { service, shop } = makeHarness();
    shop.isPincodeServiceable.mockResolvedValue(false);

    await expect(
      service.create({
        ...baseInput,
        fulfillmentType: 'DELIVERY' as any,
        deliveryAddress: '2nd floor, blue gate',
        deliveryContactPhone: '+919876543210',
        deliveryPincode: '999999',
      }),
    ).rejects.toThrow(/don't currently deliver/);
  });

  it('accepts a delivery order to a serviceable pincode', async () => {
    const { service, shop } = makeHarness();
    shop.isPincodeServiceable.mockResolvedValue(true);

    await expect(
      service.create({
        ...baseInput,
        fulfillmentType: 'DELIVERY' as any,
        deliveryAddress: '2nd floor, blue gate',
        deliveryContactPhone: '+919876543210',
        deliveryPincode: '560001',
      }),
    ).resolves.toBeDefined();
  });

  it('never checks serviceability at all when no pincode was provided — this keeps every existing delivery flow working unchanged', async () => {
    const { service, shop } = makeHarness();

    await service.create({
      ...baseInput,
      fulfillmentType: 'DELIVERY' as any,
      deliveryAddress: '2nd floor, blue gate',
      deliveryContactPhone: '+919876543210',
    });

    expect(shop.isPincodeServiceable).not.toHaveBeenCalled();
  });

  it('never checks serviceability for PICKUP orders — there is no delivery distance involved at all', async () => {
    const { service, shop } = makeHarness();

    await service.create({ ...baseInput, fulfillmentType: 'PICKUP' as any });

    expect(shop.isPincodeServiceable).not.toHaveBeenCalled();
  });

  it('creates a DeliveryOrder record for delivery orders, with the given address/phone/instructions', async () => {
    const { service, tx } = makeHarness();
    await service.create({
      ...baseInput,
      fulfillmentType: 'DELIVERY' as any,
      deliveryAddress: '2nd floor, blue gate',
      deliveryContactPhone: '+919876543210',
      deliveryInstructions: 'Ring twice',
    });

    expect(tx.deliveryOrder.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        address: '2nd floor, blue gate',
        contactPhone: '+919876543210',
        deliveryInstructions: 'Ring twice',
        deliveryOtp: expect.stringMatching(/^\d{4}$/),
      },
    });
  });

  it('stores real delivery coordinates when the browser provided them, for a live ETA on the tracking page', async () => {
    const { service, tx } = makeHarness();
    await service.create({
      ...baseInput,
      fulfillmentType: 'DELIVERY' as any,
      deliveryAddress: '2nd floor, blue gate',
      deliveryContactPhone: '+919876543210',
      deliveryLat: 12.9716,
      deliveryLng: 77.5946,
    });

    const call = tx.deliveryOrder.create.mock.calls[0][0];
    expect(call.data.deliveryLat).toBe(12.9716);
    expect(call.data.deliveryLng).toBe(77.5946);
  });

  it('adds a real, server-computed delivery fee ON TOP of the product total for what the customer actually pays', async () => {
    const { service, tx, shop } = makeHarness();
    shop.quoteDeliveryFee.mockResolvedValue({ zoneId: 'z1', zoneName: 'Nearby', distanceKm: 2, feeRs: 30, estimatedMinutes: 20 });

    await service.create({
      ...baseInput,
      fulfillmentType: 'DELIVERY' as any,
      deliveryAddress: '2nd floor, blue gate',
      deliveryContactPhone: '+919876543210',
      deliveryLat: 12.9716,
      deliveryLng: 77.5946,
    });

    const orderCall = tx.order.create.mock.calls[0][0];
    expect(orderCall.data.deliveryFeeRs).toBe(30);
    // The PAYMENT amount (what the customer is actually charged) must
    // include the fee — the product totalRs itself does not, so that
    // loyalty points/coupon logic stay based on product value alone.
    expect(orderCall.data.payment.create.amountRs).toBe(orderCall.data.totalRs + 30);
  });

  it('charges zero delivery fee, not a crash, when the shop has no zone configured for this location', async () => {
    const { service, tx, shop } = makeHarness();
    shop.quoteDeliveryFee.mockResolvedValue(null); // beyond every zone, or none configured at all

    await service.create({
      ...baseInput,
      fulfillmentType: 'DELIVERY' as any,
      deliveryAddress: '2nd floor, blue gate',
      deliveryContactPhone: '+919876543210',
      deliveryLat: 12.9716,
      deliveryLng: 77.5946,
    });

    const orderCall = tx.order.create.mock.calls[0][0];
    expect(orderCall.data.deliveryFeeRs).toBe(0);
    expect(orderCall.data.payment.create.amountRs).toBe(orderCall.data.totalRs);
  });

  it('never even attempts a fee quote for a DELIVERY order with no coordinates on file', async () => {
    const { service, shop } = makeHarness();

    await service.create({
      ...baseInput,
      fulfillmentType: 'DELIVERY' as any,
      deliveryAddress: '2nd floor, blue gate',
      deliveryContactPhone: '+919876543210',
    });

    expect(shop.quoteDeliveryFee).not.toHaveBeenCalled();
  });

  it('never attempts a fee quote at all for a PICKUP order, even with coordinates somehow present', async () => {
    const { service, shop } = makeHarness();

    await service.create({ ...baseInput, fulfillmentType: 'PICKUP' as any, deliveryLat: 12.9716, deliveryLng: 77.5946 } as any);

    expect(shop.quoteDeliveryFee).not.toHaveBeenCalled();
  });

  it('never earns loyalty points on the delivery fee — grantOrderRewards still receives the product-only totalRs', async () => {
    const { service, tx, shop, points } = makeHarness();
    shop.quoteDeliveryFee.mockResolvedValue({ zoneId: 'z1', zoneName: 'Nearby', distanceKm: 2, feeRs: 30, estimatedMinutes: 20 });
    tx.order.update.mockResolvedValue({});

    await service.create({
      ...baseInput,
      fulfillmentType: 'DELIVERY' as any,
      deliveryAddress: '2nd floor, blue gate',
      deliveryContactPhone: '+919876543210',
      deliveryLat: 12.9716,
      deliveryLng: 77.5946,
      markPaidImmediately: true,
    } as any);

    const orderCall = tx.order.create.mock.calls[0][0];
    // points.award should have been called with points computed from
    // totalRs alone (not totalRs + 30 delivery fee)
    const expectedPoints = Math.floor(orderCall.data.totalRs / 10) * 2;
    expect(points.award).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ points: expectedPoints }));
  });

  it('saves the delivery address onto the customer profile as their last-known location', async () => {
    const { service, tx } = makeHarness();
    await service.create({
      ...baseInput,
      fulfillmentType: 'DELIVERY' as any,
      deliveryAddress: '2nd floor, blue gate',
      deliveryContactPhone: '+919876543210',
    });

    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { address: '2nd floor, blue gate' },
    });
  });

  it('does not create a DeliveryOrder for pickup orders', async () => {
    const { service, tx } = makeHarness();
    await service.create(baseInput);

    expect(tx.deliveryOrder.create).not.toHaveBeenCalled();
  });

  it('rejects a coupon code that does not exist', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue(null);

    await expect(service.create({ ...baseInput, couponCode: 'FAKE10' })).rejects.toThrow(/Invalid coupon code/);
  });

  it('rejects a coupon that has been deactivated', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1', isActive: false, validFrom: new Date(Date.now() - 10000), validUntil: new Date(Date.now() + 10000), usageLimit: null, timesUsed: 0,
    });

    await expect(service.create({ ...baseInput, couponCode: 'OLD10' })).rejects.toThrow(/no longer active/);
  });

  it('rejects a coupon outside its valid date window', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1', isActive: true, validFrom: new Date(Date.now() + 100000), validUntil: new Date(Date.now() + 200000), usageLimit: null, timesUsed: 0,
    });

    await expect(service.create({ ...baseInput, couponCode: 'FUTURE10' })).rejects.toThrow(/expired or is not yet valid/);
  });

  it('rejects a coupon that has hit its usage limit', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1', isActive: true, validFrom: new Date(Date.now() - 10000), validUntil: new Date(Date.now() + 10000), usageLimit: 5, timesUsed: 5,
    });

    await expect(service.create({ ...baseInput, couponCode: 'MAXED10' })).rejects.toThrow(/usage limit/);
  });

  it('applies a valid coupon discount and increments its usage counter', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1', isActive: true, validFrom: new Date(Date.now() - 10000), validUntil: new Date(Date.now() + 10000), usageLimit: 10, timesUsed: 2, discountRs: 20, discountPct: null,
    });

    await service.create({ ...baseInput, couponCode: 'SAVE20' });

    expect(tx.coupon.update).toHaveBeenCalledWith({ where: { id: 'coupon-1' }, data: { timesUsed: { increment: 1 } } });
  });

  it('rejects a coupon when the order is below its minimum order value', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1', isActive: true, validFrom: new Date(Date.now() - 10000), validUntil: new Date(Date.now() + 10000), usageLimit: null, timesUsed: 0, minOrderRs: 500,
    });

    await expect(service.create({ ...baseInput, couponCode: 'BIG500' })).rejects.toThrow(/minimum order/);
  });

  it('accepts a coupon when the order meets its minimum order value exactly', async () => {
    const { service, tx } = makeHarness();
    // baseInput's real subtotal (from makeProduct's basePriceRs) is 149
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1', isActive: true, validFrom: new Date(Date.now() - 10000), validUntil: new Date(Date.now() + 10000), usageLimit: null, timesUsed: 0, minOrderRs: 149, discountRs: 10, discountPct: null,
    });

    await expect(service.create({ ...baseInput, couponCode: 'MIN149' })).resolves.toBeDefined();
  });

  it('rejects a first-order-only coupon when the customer already has prior orders', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1', isActive: true, validFrom: new Date(Date.now() - 10000), validUntil: new Date(Date.now() + 10000), usageLimit: null, timesUsed: 0, firstOrderOnly: true,
    });
    tx.order.count.mockResolvedValue(3); // already has 3 prior orders

    await expect(service.create({ ...baseInput, couponCode: 'WELCOME10' })).rejects.toThrow(/only valid on your first order/);
  });

  it('accepts a first-order-only coupon for a genuinely brand-new customer', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1', isActive: true, validFrom: new Date(Date.now() - 10000), validUntil: new Date(Date.now() + 10000), usageLimit: null, timesUsed: 0, firstOrderOnly: true, discountRs: 10, discountPct: null,
    });
    tx.order.count.mockResolvedValue(0);

    await expect(service.create({ ...baseInput, couponCode: 'WELCOME10' })).resolves.toBeDefined();
  });

  it('rejects a coupon once a customer has already used it the maximum number of times allowed per person', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1', isActive: true, validFrom: new Date(Date.now() - 10000), validUntil: new Date(Date.now() + 10000), usageLimit: null, timesUsed: 0, maxUsesPerCustomer: 2,
    });
    tx.order.count.mockResolvedValue(2); // this customer has already used it twice

    await expect(service.create({ ...baseInput, couponCode: 'REPEAT10' })).rejects.toThrow(/maximum number of times/);
  });

  it('checks the per-customer usage count scoped to this specific coupon, not orders in general', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1', isActive: true, validFrom: new Date(Date.now() - 10000), validUntil: new Date(Date.now() + 10000), usageLimit: null, timesUsed: 0, maxUsesPerCustomer: 2,
    });
    tx.order.count.mockResolvedValue(1);

    await service.create({ ...baseInput, couponCode: 'REPEAT10' });

    expect(tx.order.count).toHaveBeenCalledWith({ where: { customerId: 'cust-1', couponId: 'coupon-1' } });
  });

  it('rejects any order while the shop is marked closed', async () => {
    const { service, shop, prisma } = makeHarness();
    shop.isOpen.mockResolvedValue(false);

    await expect(service.create(baseInput)).rejects.toThrow(/currently closed/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when a chosen product contains an allergen on the customer profile', async () => {
    const product = makeProduct({ allergens: [{ allergen: { name: 'Milk' } }] });
    const customer = makeCustomer(['Milk']);
    const { service } = makeHarness({ product, customer });

    await expect(service.create(baseInput)).rejects.toThrow(/contains Milk/);
  });

  it('rejects when a required customisation group (e.g. Flavour) has no selection', async () => {
    const { service } = makeHarness();
    const input = { ...baseInput, items: [{ productId: 'prod-shake', quantity: 1, addonIds: ['base-whey', 'liquid-milk'] }] };

    await expect(service.create(input)).rejects.toThrow(/choose exactly one flavour option/);
  });

  it('rejects when a required customisation group has two conflicting selections', async () => {
    const product = makeProduct({
      addonOptions: [
        ...makeProduct().addonOptions,
        { id: 'base-plant', group: 'BASE', isRequired: true, extraPriceRs: 10, extraProteinG: 20, extraCalories: 110 },
      ],
    });
    const { service } = makeHarness({ product });
    const input = {
      ...baseInput,
      items: [{ productId: 'prod-shake', quantity: 1, addonIds: ['base-whey', 'base-plant', 'flavour-choc', 'liquid-milk'] }],
    };

    await expect(service.create(input)).rejects.toThrow(/choose exactly one base option/);
  });

  it('rejects an order for an inactive (disabled) product', async () => {
    const product = makeProduct({ isActive: false });
    const { service } = makeHarness({ product });

    await expect(service.create(baseInput)).rejects.toThrow(/unavailable/);
  });

  it('computes correct totals including add-on price, protein, and calories', async () => {
    const { service, tx } = makeHarness();
    const input = {
      ...baseInput,
      items: [{ productId: 'prod-shake', quantity: 2, addonIds: ['base-whey', 'flavour-choc', 'liquid-milk', 'addon-banana'] }],
    };

    await service.create(input);

    // base 149 + banana 15 = 164/unit * 2 = 328
    // protein: (30 base nutrition + 24 whey + 1 banana) * 2 = 110
    // calories: (320 + 120 whey + 60 milk + 100 banana) * 2 = 1200
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotalRs: 328,
          totalRs: 328,
          totalProteinG: 110,
          totalCalories: 1200,
        }),
      }),
    );
  });

  it('trims whitespace and stores special instructions on the item', async () => {
    const { service, tx } = makeHarness();
    const input = { ...baseInput, items: [{ productId: 'prod-shake', quantity: 1, addonIds: ['base-whey', 'flavour-choc', 'liquid-milk'], specialInstructions: '  no ice, extra hot  ' }] };

    await service.create(input);

    const createCall = tx.order.create.mock.calls[0][0];
    expect(createCall.data.items.create[0].specialInstructions).toBe('no ice, extra hot');
  });

  it('caps special instructions at 200 characters — a kitchen note should not be able to become an essay', async () => {
    const { service, tx } = makeHarness();
    const longNote = 'x'.repeat(500);
    const input = { ...baseInput, items: [{ productId: 'prod-shake', quantity: 1, addonIds: ['base-whey', 'flavour-choc', 'liquid-milk'], specialInstructions: longNote }] };

    await service.create(input);

    const createCall = tx.order.create.mock.calls[0][0];
    expect(createCall.data.items.create[0].specialInstructions).toHaveLength(200);
  });

  it('leaves specialInstructions undefined, not an empty string, when none is given', async () => {
    const { service, tx } = makeHarness();

    await service.create(baseInput);

    const createCall = tx.order.create.mock.calls[0][0];
    expect(createCall.data.items.create[0].specialInstructions).toBeUndefined();
  });

  it('debits the wallet for the full order total and marks payment PAID immediately when paying by wallet — no gateway confirmation is needed, the money already moved', async () => {
    const { service, tx, wallet } = makeHarness();

    const result = await service.create({ ...baseInput, paymentMethod: 'WALLET' as any });

    expect(wallet.debit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ customerId: 'cust-1', amountRs: 149, type: 'ORDER_PAYMENT', orderId: 'order-1' }),
    );
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payment: { create: expect.objectContaining({ status: 'PAID' }) } }) }),
    );
    expect(result).toBeDefined();
  });

  it('rolls back the entire order when the wallet debit fails — insufficient funds must not leave a half-created paid order behind', async () => {
    const { service, wallet } = makeHarness();
    wallet.debit.mockRejectedValue(new Error('Insufficient wallet balance'));

    await expect(service.create({ ...baseInput, paymentMethod: 'WALLET' as any })).rejects.toThrow(/Insufficient wallet balance/);
  });

  it('never touches the wallet at all for non-wallet payment methods', async () => {
    const { service, wallet } = makeHarness();

    await service.create({ ...baseInput, paymentMethod: 'CASH' as any });

    expect(wallet.debit).not.toHaveBeenCalled();
  });

  it('creates a PENDING payment record with the chosen method', async () => {
    const { service, tx } = makeHarness();
    await service.create({ ...baseInput, paymentMethod: 'UPI' as any });

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payment: { create: expect.objectContaining({ method: 'UPI', status: 'PENDING' }) },
        }),
      }),
    );
  });

  it('does NOT grant points/streak immediately for a plain self-checkout CASH order — payment is only PENDING until actually collected (regression test: this used to double-grant rewards once at placement and again at cash collection)', async () => {
    const { service, points, streaks } = makeHarness();
    await service.create(baseInput);

    expect(points.award).not.toHaveBeenCalled();
    expect(streaks.recordQualifyingActivity).not.toHaveBeenCalled();
  });

  it('defers points and streak for online payment methods until payment is confirmed', async () => {
    const { service, points, streaks } = makeHarness();
    await service.create({ ...baseInput, paymentMethod: 'UPI' as any });

    expect(points.award).not.toHaveBeenCalled();
    expect(streaks.recordQualifyingActivity).not.toHaveBeenCalled();
  });

  it('formats the order number from the real database-assigned sequence number, not a random value', async () => {
    const { service, tx } = makeHarness();
    tx.order.create.mockResolvedValue({ id: 'order-1', sequenceNumber: 47, status: 'RECEIVED', items: [], payment: {} });

    const result = await service.create(baseInput);

    expect(result.orderNumber).toBe('PP0047');
  });

  it('zero-pads sequence numbers under 1000 to a consistent 4-digit width', async () => {
    const { service, tx } = makeHarness();
    tx.order.create.mockResolvedValue({ id: 'order-1', sequenceNumber: 3, status: 'RECEIVED', items: [], payment: {} });

    const result = await service.create(baseInput);

    expect(result.orderNumber).toBe('PP0003');
  });

  it('does not zero-pad past 4 digits once the shop has genuinely placed 10,000+ orders', async () => {
    const { service, tx } = makeHarness();
    tx.order.create.mockResolvedValue({ id: 'order-1', sequenceNumber: 10234, status: 'RECEIVED', items: [], payment: {} });

    const result = await service.create(baseInput);

    expect(result.orderNumber).toBe('PP10234');
  });

  it('uses a real placeholder (not the final number) on the initial insert, before the sequence value is known — the real number is set by a second write once it is', async () => {
    const { service, tx } = makeHarness();

    await service.create(baseInput);

    const createCall = tx.order.create.mock.calls[0][0];
    expect(createCall.data.orderNumber).toMatch(/^PENDING-/);
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'order-1' }, data: { orderNumber: 'PP1234' } });
  });

  it('sends the e-bill immediately for CASH orders even though rewards are deferred', async () => {
    const { service, notificationQueue } = makeHarness();
    await service.create(baseInput);

    expect(notificationQueue.queueInvoiceEmail).toHaveBeenCalledWith('order-1');
  });

  it('sends an in-app notification for every order, regardless of channel or payment method — this was previously missing entirely, not just for POS', async () => {
    const { service, notificationCenter } = makeHarness();
    await service.create({ ...baseInput, channel: 'IN_STORE' as any, paymentMethod: 'CASH' as any, markPaidImmediately: true });

    expect(notificationCenter.notifyCustomer).toHaveBeenCalledWith(
      'cust-1',
      'ORDER_UPDATE',
      'Order Confirmed',
      expect.stringContaining('confirmed'),
    );
  });

  it('includes the real order number in the in-app notification body, not a placeholder', async () => {
    const { service, notificationCenter, tx } = makeHarness();
    tx.order.create.mockResolvedValue({ id: 'order-1', orderNumber: 'PP9999', sequenceNumber: 9999, status: 'RECEIVED', items: [], payment: {} });

    await service.create(baseInput);

    expect(notificationCenter.notifyCustomer).toHaveBeenCalledWith(
      'cust-1',
      'ORDER_UPDATE',
      'Order Confirmed',
      expect.stringContaining('PP9999'),
    );
  });

  it('never lets a notification-center failure affect the order that already succeeded', async () => {
    const { service, notificationCenter } = makeHarness();
    notificationCenter.notifyCustomer.mockRejectedValue(new Error('notification service down'));

    await expect(service.create(baseInput)).resolves.toBeDefined();
  });

  it('deducts ingredient stock for every order regardless of payment method', async () => {
    const { service, inventory } = makeHarness();
    await service.create({ ...baseInput, paymentMethod: 'UPI' as any });

    expect(inventory.deductForOrder).toHaveBeenCalledWith(
      expect.anything(),
      [{ productId: 'prod-shake', quantity: 1 }],
    );
  });

  it('does not send the e-bill for online payment methods until payment is confirmed', async () => {
    const { service, notificationQueue } = makeHarness();
    await service.create({ ...baseInput, paymentMethod: 'UPI' as any });

    expect(notificationQueue.queueInvoiceEmail).not.toHaveBeenCalled();
  });

  it('debits the wallet and marks the order PAID immediately when paying by WALLET — no gateway confirmation is needed for money already moved', async () => {
    const { service, tx, wallet } = makeHarness();

    await service.create({ ...baseInput, paymentMethod: 'WALLET' as any });

    expect(wallet.debit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ customerId: 'cust-1', amountRs: 149, type: 'ORDER_PAYMENT' }),
    );
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ payment: { create: expect.objectContaining({ status: 'PAID' }) } }) }),
    );
  });

  it('never calls wallet.debit for a non-wallet payment method', async () => {
    const { service, wallet } = makeHarness();

    await service.create({ ...baseInput, paymentMethod: 'CASH' as any });

    expect(wallet.debit).not.toHaveBeenCalled();
  });

  it('propagates an insufficient-balance error from the wallet debit — the whole order creation must fail together, not leave a paid-looking order with no real payment behind it', async () => {
    const { service, wallet } = makeHarness();
    wallet.debit.mockRejectedValue(new BadRequestException('Insufficient wallet balance'));

    await expect(service.create({ ...baseInput, paymentMethod: 'WALLET' as any })).rejects.toThrow(/Insufficient wallet balance/);
  });

  it('marks the payment PAID immediately for a POS/counter sale, even with an online-style method', async () => {
    const { service, tx } = makeHarness();
    await service.create({ ...baseInput, paymentMethod: 'UPI' as any, markPaidImmediately: true });

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payment: { create: expect.objectContaining({ status: 'PAID', paidAt: expect.any(Date) }) },
        }),
      }),
    );
  });

  it('grants rewards and sends the e-bill immediately for a POS sale regardless of payment method', async () => {
    const { service, points, notificationQueue } = makeHarness();
    await service.create({ ...baseInput, paymentMethod: 'CARD' as any, markPaidImmediately: true });

    expect(points.award).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceType: PointsSourceType.PURCHASE }));
    expect(notificationQueue.queueInvoiceEmail).toHaveBeenCalledWith('order-1');
  });

  it('records which staff/admin account processed a POS sale', async () => {
    const { service, tx } = makeHarness();
    await service.create({ ...baseInput, markPaidImmediately: true, processedByUserId: 'admin-user-1' });

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ processedByUserId: 'admin-user-1' }) }),
    );
  });

  it('leaves processedByUserId unset for ordinary self-service orders', async () => {
    const { service, tx } = makeHarness();
    await service.create(baseInput);

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ processedByUserId: undefined }) }),
    );
  });

  it('broadcasts a live order-status update after creation regardless of payment method', async () => {
    const { service, gateway } = makeHarness();
    await service.create({ ...baseInput, paymentMethod: 'UPI' as any });

    expect(gateway.emitOrderStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', customerId: 'cust-1' }),
    );
  });

  it('returns the existing order without creating a new one when the idempotency key already exists', async () => {
    const { service, prisma, tx } = makeHarness();
    prisma.order.findUnique.mockResolvedValue({ id: 'order-EXISTING', orderNumber: 'PP0001' });

    const result = await service.create({ ...baseInput, idempotencyKey: 'offline-sale-abc123' });

    expect(result).toEqual({ id: 'order-EXISTING', orderNumber: 'PP0001' });
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('creates a new order and stores the idempotency key when none exists yet', async () => {
    const { service, prisma, tx } = makeHarness();
    prisma.order.findUnique.mockResolvedValue(null);

    await service.create({ ...baseInput, idempotencyKey: 'offline-sale-abc123' });

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ idempotencyKey: 'offline-sale-abc123' }) }),
    );
  });

  it('does not perform an idempotency lookup at all for a normal order with no key', async () => {
    const { service, prisma } = makeHarness();

    await service.create(baseInput);

    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it('recovers from a race — a unique-constraint violation on idempotencyKey returns the winning order instead of throwing', async () => {
    const { service, prisma, tx } = makeHarness();
    prisma.order.findUnique
      .mockResolvedValueOnce(null) // pre-check: not found yet
      .mockResolvedValueOnce({ id: 'order-WON-THE-RACE', orderNumber: 'PP0002' }); // post-error re-check
    const raceError = { code: 'P2002', meta: { target: ['idempotencyKey'] } };
    tx.order.create.mockRejectedValueOnce(raceError);

    const result = await service.create({ ...baseInput, idempotencyKey: 'offline-sale-race' });

    expect(result).toEqual({ id: 'order-WON-THE-RACE', orderNumber: 'PP0002' });
  });

  it('re-throws an unrelated database error rather than swallowing it', async () => {
    const { service, tx } = makeHarness();
    tx.order.create.mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.create({ ...baseInput, idempotencyKey: 'offline-sale-x' })).rejects.toThrow('connection lost');
  });

  it('rejects a redemption that belongs to a different customer', async () => {
    const { service, tx } = makeHarness();
    tx.rewardRedemption.findUniqueOrThrow.mockResolvedValue({
      id: 'redemption-1',
      customerId: 'cust-OTHER',
      usedAt: null,
      reward: { type: 'DISCOUNT', valueRs: 50 },
    });

    await expect(service.create({ ...baseInput, redemptionId: 'redemption-1' })).rejects.toThrow(
      /does not belong to this customer/,
    );
  });

  it('rejects a redemption that has already been used', async () => {
    const { service, tx } = makeHarness();
    tx.rewardRedemption.findUniqueOrThrow.mockResolvedValue({
      id: 'redemption-1',
      customerId: 'cust-1',
      usedAt: new Date('2026-08-01'),
      reward: { type: 'DISCOUNT', valueRs: 50 },
    });

    await expect(service.create({ ...baseInput, redemptionId: 'redemption-1' })).rejects.toThrow(
      /already been used/,
    );
  });

  it('rejects a non-DISCOUNT-type reward — FREE_ITEM/FREE_ADDON are not a flat rupee amount', async () => {
    const { service, tx } = makeHarness();
    tx.rewardRedemption.findUniqueOrThrow.mockResolvedValue({
      id: 'redemption-1',
      customerId: 'cust-1',
      usedAt: null,
      reward: { type: 'FREE_ITEM', valueRs: null },
    });

    await expect(service.create({ ...baseInput, redemptionId: 'redemption-1' })).rejects.toThrow(
      /handled manually/,
    );
  });

  it('adds the reward value to discountRs on the created order', async () => {
    const { service, tx } = makeHarness();
    tx.rewardRedemption.findUniqueOrThrow.mockResolvedValue({
      id: 'redemption-1',
      customerId: 'cust-1',
      usedAt: null,
      reward: { type: 'DISCOUNT', valueRs: 50 },
    });

    await service.create({ ...baseInput, redemptionId: 'redemption-1' });

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ discountRs: 50 }) }),
    );
  });

  it('stacks with a coupon discount rather than replacing it', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1',
      code: 'SAVE10',
      isActive: true,
      validFrom: new Date('2020-01-01'),
      validUntil: new Date('2030-01-01'),
      usageLimit: null,
      timesUsed: 0,
      discountRs: 20,
      discountPct: null,
    });
    tx.rewardRedemption.findUniqueOrThrow.mockResolvedValue({
      id: 'redemption-1',
      customerId: 'cust-1',
      usedAt: null,
      reward: { type: 'DISCOUNT', valueRs: 50 },
    });

    await service.create({ ...baseInput, couponCode: 'SAVE10', redemptionId: 'redemption-1' });

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ discountRs: 70 }) }),
    );
  });

  it('marks the redemption used and links it to the resulting order — the actual enforcement against reuse', async () => {
    const { service, tx } = makeHarness();
    tx.rewardRedemption.findUniqueOrThrow.mockResolvedValue({
      id: 'redemption-1',
      customerId: 'cust-1',
      usedAt: null,
      reward: { type: 'DISCOUNT', valueRs: 50 },
    });

    await service.create({ ...baseInput, redemptionId: 'redemption-1' });

    expect(tx.rewardRedemption.update).toHaveBeenCalledWith({
      where: { id: 'redemption-1' },
      data: { usedAt: expect.any(Date), orderId: 'order-1' },
    });
  });

  it('does not touch rewardRedemption at all when no redemptionId is given', async () => {
    const { service, tx } = makeHarness();

    await service.create(baseInput);

    expect(tx.rewardRedemption.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.rewardRedemption.update).not.toHaveBeenCalled();
  });

  it('applies a manual discount to the order total', async () => {
    const { service, tx } = makeHarness();

    await service.create({ ...baseInput, manualDiscountRs: 30 });

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ discountRs: 30 }) }),
    );
  });

  it('rejects a negative manual discount', async () => {
    const { service } = makeHarness();

    await expect(service.create({ ...baseInput, manualDiscountRs: -10 })).rejects.toThrow(/cannot be negative/);
  });

  it('rejects a manual discount larger than the subtotal — an admin typo should not create a negative-value sale', async () => {
    const { service } = makeHarness();

    await expect(service.create({ ...baseInput, manualDiscountRs: 999_999 })).rejects.toThrow(/cannot exceed/);
  });

  it('stacks a manual discount with a coupon discount rather than replacing it', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1',
      code: 'SAVE10',
      isActive: true,
      validFrom: new Date('2020-01-01'),
      validUntil: new Date('2030-01-01'),
      usageLimit: null,
      timesUsed: 0,
      discountRs: 20,
      discountPct: null,
    });

    await service.create({ ...baseInput, couponCode: 'SAVE10', manualDiscountRs: 15 });

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ discountRs: 35 }) }),
    );
  });

  it('never lets the total go negative even if discounts exceed the subtotal in combination', async () => {
    const { service, tx } = makeHarness();
    tx.coupon.findUnique.mockResolvedValue({
      id: 'coupon-1',
      code: 'BIG',
      isActive: true,
      validFrom: new Date('2020-01-01'),
      validUntil: new Date('2030-01-01'),
      usageLimit: null,
      timesUsed: 0,
      discountRs: 140, // close to the whole subtotal on its own
      discountPct: null,
    });

    await service.create({ ...baseInput, couponCode: 'BIG', manualDiscountRs: 5 });

    const call = tx.order.create.mock.calls[0][0];
    expect(call.data.totalRs).toBeGreaterThanOrEqual(0);
  });
});

describe('OrdersService.findByCustomer', () => {
  it('includes payment info in the order list — needed so the frontend can show a "Pay Now" retry for anything still PENDING', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findMany.mockResolvedValue([]);

    await service.findByCustomer('cust-1');

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          payment: true,
          items: { include: { product: true, addons: { include: { addon: true } } } },
        }),
      }),
    );
  });
});

describe('OrdersService.findOneForCustomer', () => {
  it('rejects fetching an order that does not belong to this customer', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 'order-1', customerId: 'cust-OTHER' });

    await expect(service.findOneForCustomer('cust-1', 'order-1')).rejects.toThrow(/does not belong to you/);
  });

  it('includes the delivery OTP so the customer can read it out to the rider', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 'order-1', customerId: 'cust-1' });

    await service.findOneForCustomer('cust-1', 'order-1');

    const call = prisma.order.findUniqueOrThrow.mock.calls[0][0];
    expect(call.include.deliveryOrder.select.deliveryOtp).toBe(true);
  });

  it('computes real rider stats (avg rating, completed delivery count) when a rider is actually assigned', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1', customerId: 'cust-1', deliveryOrder: { deliveryPersonId: 'rider-1' },
    });
    prisma.deliveryRating.aggregate.mockResolvedValue({ _avg: { rating: 4.9 } });
    prisma.deliveryOrder.count.mockResolvedValue(230);

    const result = await service.findOneForCustomer('cust-1', 'order-1');

    expect(result.riderStats).toEqual({ avgRating: 4.9, totalDeliveries: 230 });
  });

  it('does not compute rider stats at all when no rider is assigned yet — a PICKUP order, or delivery not yet assigned', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 'order-1', customerId: 'cust-1', deliveryOrder: null });

    const result = await service.findOneForCustomer('cust-1', 'order-1');

    expect(result.riderStats).toBeNull();
    expect(prisma.deliveryRating.aggregate).not.toHaveBeenCalled();
  });
});

describe('OrdersService.notifyStatusChange', () => {
  it('sends the exact "X is your delivery partner" notification when a rider is assigned, with the real rider name', async () => {
    const { service, prisma, notificationCenter } = makeHarness();
    prisma.order.findUnique.mockResolvedValue({ orderNumber: 'PP0042', customerId: 'cust-1' });

    await service.notifyStatusChange('order-1', 'ASSIGNED', 'Lathif');

    expect(notificationCenter.notifyCustomer).toHaveBeenCalledWith(
      'cust-1', 'ORDER_UPDATE', 'Lathif is your delivery partner', 'They are on their way to pick up your order.',
    );
  });

  it('falls back to a generic message when a rider is assigned but somehow has no name on record', async () => {
    const { service, prisma, notificationCenter } = makeHarness();
    prisma.order.findUnique.mockResolvedValue({ orderNumber: 'PP0042', customerId: 'cust-1' });

    await service.notifyStatusChange('order-1', 'ASSIGNED');

    expect(notificationCenter.notifyCustomer).toHaveBeenCalledWith(
      'cust-1', 'ORDER_UPDATE', 'Rider Assigned', expect.stringContaining('PP0042'),
    );
  });

  it('sends a real notification for every meaningful customer-facing stage, not just order confirmation', async () => {
    const { service, prisma, notificationCenter } = makeHarness();
    prisma.order.findUnique.mockResolvedValue({ orderNumber: 'PP0042', customerId: 'cust-1' });

    for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'ARRIVED', 'DELIVERED']) {
      notificationCenter.notifyCustomer.mockClear();
      await service.notifyStatusChange('order-1', status);
      expect(notificationCenter.notifyCustomer).toHaveBeenCalledTimes(1);
    }
  });

  it('does nothing for a status with no defined customer-facing message (e.g. an internal-only status)', async () => {
    const { service, prisma, notificationCenter } = makeHarness();
    prisma.order.findUnique.mockResolvedValue({ orderNumber: 'PP0042', customerId: 'cust-1' });

    await service.notifyStatusChange('order-1', 'RECEIVED');

    expect(notificationCenter.notifyCustomer).not.toHaveBeenCalled();
  });

  it('does nothing (no crash) when the order cannot be found at all', async () => {
    const { service, prisma, notificationCenter } = makeHarness();
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(service.notifyStatusChange('order-missing', 'ACCEPTED')).resolves.toBeUndefined();
    expect(notificationCenter.notifyCustomer).not.toHaveBeenCalled();
  });
});

describe('OrdersService.updateStatus', () => {
  it('fires a customer notification for the new status, not just the real-time socket update', async () => {
    const { service, tx, prisma } = makeHarness();
    prisma.order.update = jest.fn().mockResolvedValue({ id: 'order-1', orderNumber: 'PP0042', customerId: 'cust-1', status: 'ACCEPTED', deliveryOrder: null });
    prisma.order.findUnique.mockResolvedValue({ orderNumber: 'PP0042', customerId: 'cust-1' });
    const notifySpy = jest.spyOn(service, 'notifyStatusChange');

    await service.updateStatus('order-1', 'ACCEPTED');

    expect(notifySpy).toHaveBeenCalledWith('order-1', 'ACCEPTED');
  });
});

describe('OrdersService.tipDeliveryPerson', () => {
  function makeDeliveredOrder(overrides: Partial<any> = {}) {
    return {
      id: 'order-1',
      orderNumber: 'PP0042',
      customerId: 'cust-1',
      status: 'DELIVERED',
      deliveryOrder: { id: 'do-1', tipAmountRs: 0 },
      ...overrides,
    };
  }

  it('rejects a non-positive tip amount', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeDeliveredOrder());

    await expect(service.tipDeliveryPerson('cust-1', 'order-1', 0)).rejects.toThrow(/must be positive/);
  });

  it('rejects tipping an order that does not belong to this customer', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeDeliveredOrder({ customerId: 'cust-OTHER' }));

    await expect(service.tipDeliveryPerson('cust-1', 'order-1', 30)).rejects.toThrow(/does not belong to you/);
  });

  it('rejects tipping an order with no delivery at all (e.g. a PICKUP order)', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeDeliveredOrder({ deliveryOrder: null }));

    await expect(service.tipDeliveryPerson('cust-1', 'order-1', 30)).rejects.toThrow(/no delivery to tip/);
  });

  it('rejects tipping before the order has actually been delivered', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeDeliveredOrder({ status: 'OUT_FOR_DELIVERY' }));

    await expect(service.tipDeliveryPerson('cust-1', 'order-1', 30)).rejects.toThrow(/after your order has been delivered/);
  });

  it('rejects tipping the same delivery twice', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeDeliveredOrder({ deliveryOrder: { id: 'do-1', tipAmountRs: 30 } }));

    await expect(service.tipDeliveryPerson('cust-1', 'order-1', 20)).rejects.toThrow(/already tipped/);
  });

  it('debits the wallet and records the tip amount for a valid tip', async () => {
    const { service, prisma, tx, wallet } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeDeliveredOrder());

    await service.tipDeliveryPerson('cust-1', 'order-1', 30);

    expect(wallet.debit).toHaveBeenCalledWith(tx, expect.objectContaining({ customerId: 'cust-1', amountRs: 30, type: 'TIP' }));
    expect(tx.deliveryOrder.update).toHaveBeenCalledWith({ where: { id: 'do-1' }, data: { tipAmountRs: 30 } });
  });

  it('propagates the wallet\'s own insufficient-balance error rather than swallowing it', async () => {
    const { service, prisma, wallet } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeDeliveredOrder());
    wallet.debit.mockRejectedValue(new Error('Insufficient wallet balance'));

    await expect(service.tipDeliveryPerson('cust-1', 'order-1', 30)).rejects.toThrow(/Insufficient wallet balance/);
  });
});

describe('OrdersService.grantOrderRewards', () => {
  it('awards both the referee and referrer on the referred customer\'s first order, when they were referred', async () => {
    const { service, tx, points } = makeHarness({ customer: { id: 'cust-1', allergies: [], referredByCode: 'friend-code', name: 'Ravi' } });
    tx.customer.findUnique
      .mockResolvedValueOnce({ id: 'cust-1', referredByCode: 'friend-code', name: 'Ravi' })
      .mockResolvedValueOnce({ id: 'referrer-1', referralCode: 'friend-code' });
    tx.order.count.mockResolvedValue(1);

    await service.grantOrderRewards(tx, 'order-1', 'cust-1', 50, 149);

    expect(points.award).toHaveBeenCalledWith(tx, expect.objectContaining({ customerId: 'cust-1', points: 50, sourceType: 'REFERRAL' }));
    expect(points.award).toHaveBeenCalledWith(tx, expect.objectContaining({ customerId: 'referrer-1', points: 100, sourceType: 'REFERRAL' }));
  });

  it('does not grant a referral reward on a second or later order — this is strictly a first-order bonus', async () => {
    const { service, tx, points } = makeHarness({ customer: { id: 'cust-1', allergies: [], referredByCode: 'friend-code' } });
    tx.customer.findUnique.mockResolvedValueOnce({ id: 'cust-1', referredByCode: 'friend-code' });
    tx.order.count.mockResolvedValue(2); // this is their 2nd order, not their 1st

    await service.grantOrderRewards(tx, 'order-2', 'cust-1', 50, 149);

    expect(points.award).not.toHaveBeenCalledWith(tx, expect.objectContaining({ sourceType: 'REFERRAL' }));
  });

  it('does not grant anything when the customer has no referredByCode at all', async () => {
    const { service, tx, points } = makeHarness({ customer: { id: 'cust-1', allergies: [], referredByCode: null } });
    tx.customer.findUnique.mockResolvedValueOnce({ id: 'cust-1', referredByCode: null });

    await service.grantOrderRewards(tx, 'order-1', 'cust-1', 50, 149);

    expect(points.award).not.toHaveBeenCalledWith(tx, expect.objectContaining({ sourceType: 'REFERRAL' }));
  });

  it('does not grant anything if the referredByCode somehow no longer matches any real customer (e.g. the referrer\'s account was later deleted)', async () => {
    const { service, tx, points } = makeHarness({ customer: { id: 'cust-1', allergies: [], referredByCode: 'stale-code' } });
    tx.customer.findUnique
      .mockResolvedValueOnce({ id: 'cust-1', referredByCode: 'stale-code' })
      .mockResolvedValueOnce(null); // the referrer lookup finds nobody
    tx.order.count.mockResolvedValue(1);

    await service.grantOrderRewards(tx, 'order-1', 'cust-1', 50, 149);

    expect(points.award).not.toHaveBeenCalledWith(tx, expect.objectContaining({ sourceType: 'REFERRAL' }));
  });

  it('awards a milestone bonus and marks the goal complete when the target is reached', async () => {
    const { service, tx, points } = makeHarness({
      activeGoal: { id: 'goal-1', targetProteinG: 100, progressG: 60 },
    });

    await service.grantOrderRewards(tx, 'order-1', 'cust-1', 50, 149);

    expect(tx.proteinGoalRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'goal-1' },
        data: expect.objectContaining({ progressG: 110, completedAt: expect.any(Date) }),
      }),
    );
    expect(points.award).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ sourceType: PointsSourceType.GOAL_ACHIEVEMENT, points: 500 }),
    );
  });

  it('progresses but does not complete a goal that has not yet reached its target', async () => {
    const { service, tx, points } = makeHarness({
      activeGoal: { id: 'goal-1', targetProteinG: 1000, progressG: 60 },
    });

    await service.grantOrderRewards(tx, 'order-1', 'cust-1', 50, 149);

    expect(tx.proteinGoalRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ progressG: 110 }) }),
    );
    expect(points.award).not.toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ sourceType: PointsSourceType.GOAL_ACHIEVEMENT }),
    );
  });

  it('does not award purchase points for a zero-value order', async () => {
    const { service, tx, points } = makeHarness();
    await service.grantOrderRewards(tx, 'order-1', 'cust-1', 0, 0);

    expect(points.award).not.toHaveBeenCalled();
  });

  it('awards points using the drop-last-digit-then-double formula: ₹150 → 30 points', async () => {
    const { service, tx, points } = makeHarness();

    await service.grantOrderRewards(tx, 'order-1', 'cust-1', 50, 150);

    expect(points.award).toHaveBeenCalledWith(tx, expect.objectContaining({ points: 30, sourceType: PointsSourceType.PURCHASE }));
  });

  it.each([
    [100, 20],
    [120, 24],
    [180, 36],
    [250, 50],
    [499, 98],
    [500, 100],
    [1000, 200],
  ])('matches the exact worked example: ₹%i → %i points', async (purchaseRs, expectedPoints) => {
    const { service, tx, points } = makeHarness();

    await service.grantOrderRewards(tx, 'order-1', 'cust-1', 50, purchaseRs);

    expect(points.award).toHaveBeenCalledWith(tx, expect.objectContaining({ points: expectedPoints }));
  });

  it('floors to the nearest 10 rupees before doubling — ₹149 behaves the same as ₹140, not ₹150', async () => {
    const { service, tx, points } = makeHarness();

    await service.grantOrderRewards(tx, 'order-1', 'cust-1', 50, 149);

    expect(points.award).toHaveBeenCalledWith(tx, expect.objectContaining({ points: 28 }));
  });
});
