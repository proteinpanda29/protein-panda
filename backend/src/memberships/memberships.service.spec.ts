import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MembershipsService } from './memberships.service';

function makeHarness() {
  const prisma = {
    membership: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
  const orders = { create: jest.fn() } as any;
  const service = new MembershipsService(prisma, orders);
  return { service, prisma, orders };
}

describe('MembershipsService.create', () => {
  it('rejects an empty item list', async () => {
    const { service } = makeHarness();
    await expect(
      service.create('cust-1', { totalDays: 7, scheduledTime: '08:30', fulfillmentType: 'PICKUP' as any, items: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a duration that is not 7 or 30 days', async () => {
    const { service } = makeHarness();
    await expect(
      service.create('cust-1', {
        totalDays: 15,
        scheduledTime: '08:30',
        fulfillmentType: 'PICKUP' as any,
        items: [{ productId: 'p1', quantity: 1 }],
      }),
    ).rejects.toThrow(/7 \(weekly\) or 30 \(monthly\)/);
  });

  it('rejects a malformed scheduled time', async () => {
    const { service } = makeHarness();
    await expect(
      service.create('cust-1', {
        totalDays: 7,
        scheduledTime: '8:30am',
        fulfillmentType: 'PICKUP' as any,
        items: [{ productId: 'p1', quantity: 1 }],
      }),
    ).rejects.toThrow(/HH:MM/);
  });

  it('rejects a DELIVERY plan missing an address or contact phone', async () => {
    const { service } = makeHarness();
    await expect(
      service.create('cust-1', {
        totalDays: 7,
        scheduledTime: '08:30',
        fulfillmentType: 'DELIVERY' as any,
        items: [{ productId: 'p1', quantity: 1 }],
      }),
    ).rejects.toThrow(/delivery address and contact phone/);
  });

  it('stores the delivery address/phone for a DELIVERY plan', async () => {
    const { service, prisma } = makeHarness();
    prisma.membership.create.mockResolvedValue({});

    await service.create('cust-1', {
      totalDays: 7,
      scheduledTime: '08:30',
      fulfillmentType: 'DELIVERY' as any,
      items: [{ productId: 'p1', quantity: 1 }],
      deliveryAddress: '2nd floor, blue gate',
      deliveryContactPhone: '+919876543210',
    });

    expect(prisma.membership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryAddress: '2nd floor, blue gate',
          deliveryContactPhone: '+919876543210',
        }),
      }),
    );
  });
});

describe('MembershipsService ownership checks', () => {
  it('refuses to pause a membership belonging to a different customer', async () => {
    const { service, prisma } = makeHarness();
    prisma.membership.findUniqueOrThrow.mockResolvedValue({ id: 'm1', customerId: 'cust-OTHER' });

    await expect(service.pause('cust-1', 'm1')).rejects.toThrow(ForbiddenException);
  });

  it('refuses to resume a cancelled membership', async () => {
    const { service, prisma } = makeHarness();
    prisma.membership.findUniqueOrThrow.mockResolvedValue({ id: 'm1', customerId: 'cust-1', status: 'CANCELLED' });

    await expect(service.resume('cust-1', 'm1')).rejects.toThrow(/ended and cannot be resumed/);
  });
});

describe('MembershipsService.generateDueOrders', () => {
  const NOW = new Date('2026-08-17T08:30:00');

  it('generates an order for an active membership due at the current time', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.membership.findMany.mockResolvedValue([
      {
        id: 'm1',
        customerId: 'cust-1',
        fulfillmentType: 'PICKUP',
        daysCompleted: 2,
        totalDays: 7,
        lastOrderDate: null,
        skipNextDate: null,
        items: [{ productId: 'p1', quantity: 1 }],
      },
    ]);
    orders.create.mockResolvedValue({ id: 'order-1' });

    const results = await service.generateDueOrders(NOW);

    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1', channel: 'MEMBERSHIP', paymentMethod: 'CASH' }),
    );
    expect(results).toEqual([{ membershipId: 'm1', orderId: 'order-1' }]);
  });

  it('passes the stored delivery address/phone through for a DELIVERY membership (regression: this used to be missing and silently broke every delivery membership)', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.membership.findMany.mockResolvedValue([
      {
        id: 'm1',
        customerId: 'cust-1',
        fulfillmentType: 'DELIVERY',
        deliveryAddress: '2nd floor, blue gate',
        deliveryContactPhone: '+919876543210',
        daysCompleted: 2,
        totalDays: 7,
        lastOrderDate: null,
        skipNextDate: null,
        items: [{ productId: 'p1', quantity: 1 }],
      },
    ]);
    orders.create.mockResolvedValue({ id: 'order-1' });

    await service.generateDueOrders(NOW);

    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentType: 'DELIVERY',
        deliveryAddress: '2nd floor, blue gate',
        deliveryContactPhone: '+919876543210',
      }),
    );
  });

  it('skips a membership that already generated an order today (idempotent within the same minute window)', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.membership.findMany.mockResolvedValue([
      {
        id: 'm1',
        customerId: 'cust-1',
        fulfillmentType: 'PICKUP',
        daysCompleted: 2,
        totalDays: 7,
        lastOrderDate: new Date('2026-08-17T08:30:00'), // same calendar day as NOW
        skipNextDate: null,
        items: [{ productId: 'p1', quantity: 1 }],
      },
    ]);

    const results = await service.generateDueOrders(NOW);

    expect(orders.create).not.toHaveBeenCalled();
    expect(results).toEqual([{ membershipId: 'm1', skipped: 'already generated today' }]);
  });

  it('honors a customer-requested skip for today and clears the flag afterward', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.membership.findMany.mockResolvedValue([
      {
        id: 'm1',
        customerId: 'cust-1',
        fulfillmentType: 'PICKUP',
        daysCompleted: 2,
        totalDays: 7,
        lastOrderDate: null,
        skipNextDate: new Date('2026-08-17T00:00:00'),
        items: [{ productId: 'p1', quantity: 1 }],
      },
    ]);

    const results = await service.generateDueOrders(NOW);

    expect(orders.create).not.toHaveBeenCalled();
    expect(prisma.membership.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { skipNextDate: null } });
    expect(results).toEqual([{ membershipId: 'm1', skipped: 'customer skipped today' }]);
  });

  it('marks the membership COMPLETED once the final day is reached', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.membership.findMany.mockResolvedValue([
      {
        id: 'm1',
        customerId: 'cust-1',
        fulfillmentType: 'PICKUP',
        daysCompleted: 6,
        totalDays: 7, // this order is the 7th and final day
        lastOrderDate: null,
        skipNextDate: null,
        items: [{ productId: 'p1', quantity: 1 }],
      },
    ]);
    orders.create.mockResolvedValue({ id: 'order-7' });

    await service.generateDueOrders(NOW);

    expect(prisma.membership.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: expect.objectContaining({ daysCompleted: 7, status: 'COMPLETED' }),
    });
  });

  it('does not let one failing membership block the rest from generating', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.membership.findMany.mockResolvedValue([
      {
        id: 'm1',
        customerId: 'cust-1',
        fulfillmentType: 'PICKUP',
        daysCompleted: 0,
        totalDays: 7,
        lastOrderDate: null,
        skipNextDate: null,
        items: [{ productId: 'bad-product', quantity: 1 }],
      },
      {
        id: 'm2',
        customerId: 'cust-2',
        fulfillmentType: 'PICKUP',
        daysCompleted: 0,
        totalDays: 7,
        lastOrderDate: null,
        skipNextDate: null,
        items: [{ productId: 'p1', quantity: 1 }],
      },
    ]);
    orders.create.mockImplementation(({ customerId }: any) => {
      if (customerId === 'cust-1') throw new Error('product is inactive');
      return Promise.resolve({ id: 'order-m2' });
    });

    const results = await service.generateDueOrders(NOW);

    expect(results).toEqual([
      { membershipId: 'm1', skipped: 'error: product is inactive' },
      { membershipId: 'm2', orderId: 'order-m2' },
    ]);
  });

  it('does not generate for memberships whose scheduled time does not match now', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.membership.findMany.mockResolvedValue([]); // the where-clause filtering is the DB's job; simulate no match

    const results = await service.generateDueOrders(NOW);

    expect(orders.create).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});
