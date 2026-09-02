import { BadRequestException } from '@nestjs/common';
import { PosService } from './pos.service';

function makeHarness() {
  const prisma = {
    customer: { findMany: jest.fn() },
    user: { findUnique: jest.fn(), create: jest.fn() },
    rewardRedemption: { findMany: jest.fn() },
  } as any;
  const orders = { create: jest.fn().mockResolvedValue({ id: 'order-1' }) } as any;
  const payments = { createPaymentLinkForOrder: jest.fn().mockResolvedValue({ paymentLinkId: 'plink_1', shortUrl: 'https://rzp.io/i/abc123', orderNumber: 'PP1234' }) } as any;
  const service = new PosService(prisma, orders, payments);
  return { service, prisma, orders, payments };
}

describe('PosService.listAvailableRedemptions', () => {
  it('only returns unused, DISCOUNT-type redemptions for this customer', async () => {
    const { service, prisma } = makeHarness();
    prisma.rewardRedemption.findMany.mockResolvedValue([]);

    await service.listAvailableRedemptions('cust-1');

    expect(prisma.rewardRedemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: 'cust-1', usedAt: null, reward: { type: 'DISCOUNT' } },
      }),
    );
  });
});

describe('PosService.searchCustomers', () => {
  it('returns an empty array for a query shorter than 2 characters (avoids scanning the whole table)', async () => {
    const { service, prisma } = makeHarness();
    const result = await service.searchCustomers('a');

    expect(result).toEqual([]);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('searches by name, phone, and email together', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findMany.mockResolvedValue([]);

    await service.searchCustomers('ravi');

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'ravi', mode: 'insensitive' } },
            { user: { phone: { contains: 'ravi' } } },
            { user: { email: { contains: 'ravi', mode: 'insensitive' } } },
          ],
        },
      }),
    );
  });
});

describe('PosService.createWalkInCustomer', () => {
  it('rejects when no identifier is given', async () => {
    const { service } = makeHarness();
    await expect(service.createWalkInCustomer('Ravi', '')).rejects.toThrow(BadRequestException);
  });

  it('refuses to create a duplicate when the phone/email already has an account', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(service.createWalkInCustomer('Ravi', '+919876543210')).rejects.toThrow(/already exists/);
  });

  it('creates a CUSTOMER-role account with no password, keyed by phone', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ customer: { id: 'cust-new', name: 'Ravi' } });

    await service.createWalkInCustomer('Ravi', '+919876543210');

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'CUSTOMER',
          phone: '+919876543210',
          email: null,
          customer: { create: { name: 'Ravi' } },
        }),
      }),
    );
  });

  it('routes an email-shaped identifier to the email field instead of phone', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ customer: { id: 'cust-new' } });

    await service.createWalkInCustomer('Ravi', 'ravi@example.com');

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: null, email: 'ravi@example.com' }) }),
    );
  });

  it('defaults the name to "Walk-in Customer" when none is given', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ customer: {} });

    await service.createWalkInCustomer('', '+919876543210');

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customer: { create: { name: 'Walk-in Customer' } } }) }),
    );
  });
});

describe('PosService.createSale', () => {
  it('always marks the sale paid immediately and attributes it to the processing staff account', async () => {
    const { service, orders } = makeHarness();

    await service.createSale('admin-user-1', {
      customerId: 'cust-1',
      items: [{ productId: 'p1', quantity: 2 }],
      paymentMethod: 'CARD' as any,
    });

    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'IN_STORE',
        markPaidImmediately: true,
        processedByUserId: 'admin-user-1',
        fulfillmentType: 'PICKUP',
      }),
    );
  });

  it('respects an explicit fulfillment type override', async () => {
    const { service, orders } = makeHarness();

    await service.createSale('admin-user-1', {
      customerId: 'cust-1',
      items: [{ productId: 'p1', quantity: 1 }],
      paymentMethod: 'CASH' as any,
      fulfillmentType: 'DELIVERY' as any,
    });

    expect(orders.create).toHaveBeenCalledWith(expect.objectContaining({ fulfillmentType: 'DELIVERY' }));
  });

  it('creates a UPI sale as PENDING, not paid immediately — there is no in-person confirmation step for UPI the way there is for cash/card', async () => {
    const { service, orders } = makeHarness();

    await service.createSale('admin-user-1', {
      customerId: 'cust-1',
      items: [{ productId: 'p1', quantity: 1 }],
      paymentMethod: 'UPI' as any,
    });

    expect(orders.create).toHaveBeenCalledWith(expect.objectContaining({ markPaidImmediately: false }));
  });

  it('generates a real Payment Link for a UPI sale and returns it alongside the order', async () => {
    const { service, payments } = makeHarness();

    const result = await service.createSale('admin-user-1', {
      customerId: 'cust-1',
      items: [{ productId: 'p1', quantity: 1 }],
      paymentMethod: 'UPI' as any,
    });

    expect(payments.createPaymentLinkForOrder).toHaveBeenCalledWith('order-1');
    expect((result as any).paymentLink).toEqual(
      expect.objectContaining({ shortUrl: 'https://rzp.io/i/abc123' }),
    );
  });

  it('never calls createPaymentLinkForOrder for CASH or CARD — no gateway needed for those', async () => {
    const { service, payments } = makeHarness();

    await service.createSale('admin-user-1', {
      customerId: 'cust-1',
      items: [{ productId: 'p1', quantity: 1 }],
      paymentMethod: 'CASH' as any,
    });

    expect(payments.createPaymentLinkForOrder).not.toHaveBeenCalled();
  });
});
