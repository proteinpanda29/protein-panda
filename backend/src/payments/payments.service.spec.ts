import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

function makeHarness() {
  const prisma: any = {
    order: { findUniqueOrThrow: jest.fn() },
    payment: { update: jest.fn(), findFirst: jest.fn() },
  };
  // Reuse the same prisma object as the transaction client so assertions
  // against prisma.payment.update also see calls made inside $transaction
  // — a separate mock object here would silently hide those calls.
  prisma.$transaction = jest.fn().mockImplementation((cb: any) => cb(prisma));
  const razorpay = {
    createOrder: jest.fn(),
    createPaymentLink: jest.fn(),
    verifySignature: jest.fn(),
    keyId: 'rzp_test_key',
  } as any;
  const orders = { grantOrderRewards: jest.fn().mockResolvedValue(undefined) } as any;
  const gateway = { emitOrderStatusUpdate: jest.fn() } as any;
  const invoices = { sendInvoiceEmail: jest.fn().mockResolvedValue(undefined) } as any;
  const notificationQueue = { queueInvoiceEmail: jest.fn().mockResolvedValue(undefined) } as any;

  const service = new PaymentsService(prisma, razorpay, orders, gateway, notificationQueue);
  return { service, prisma, razorpay, orders, gateway, invoices, notificationQueue };
}

describe('PaymentsService.createRazorpayOrder', () => {
  it('refuses to create a payment order for someone else\'s order', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      customerId: 'cust-OTHER',
      payment: { id: 'pay-1', status: 'PENDING', amountRs: 149 },
    });

    await expect(service.createRazorpayOrder('cust-1', 'order-1')).rejects.toThrow(ForbiddenException);
  });

  it('refuses to re-pay an order that is already PAID', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      customerId: 'cust-1',
      payment: { id: 'pay-1', status: 'PAID', amountRs: 149 },
    });

    await expect(service.createRazorpayOrder('cust-1', 'order-1')).rejects.toThrow(BadRequestException);
  });

  it('creates a Razorpay order for the exact pending amount and stashes the gateway order id', async () => {
    const { service, prisma, razorpay } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PP1234',
      customerId: 'cust-1',
      payment: { id: 'pay-1', status: 'PENDING', amountRs: 149 },
    });
    razorpay.createOrder.mockResolvedValue({ id: 'order_rzp_1', amount: 14900, currency: 'INR' });

    const result = await service.createRazorpayOrder('cust-1', 'order-1');

    expect(razorpay.createOrder).toHaveBeenCalledWith({ amountRs: 149, receipt: 'PP1234' });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { transactionRef: 'order_rzp_1' },
    });
    expect(result).toEqual(
      expect.objectContaining({ razorpayOrderId: 'order_rzp_1', amountPaise: 14900, keyId: 'rzp_test_key' }),
    );
  });
});

describe('PaymentsService.createPaymentLinkForOrder', () => {
  it('refuses to re-pay an order that is already PAID', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      payment: { id: 'pay-1', status: 'PAID', amountRs: 149 },
    });

    await expect(service.createPaymentLinkForOrder('order-1')).rejects.toThrow(BadRequestException);
  });

  it('has no customer-ownership check — this is admin/POS-initiated, not a customer request', async () => {
    const { service, prisma, razorpay } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PP1234',
      customerId: 'some-other-customer-entirely',
      payment: { id: 'pay-1', status: 'PENDING', amountRs: 149 },
    });
    razorpay.createPaymentLink.mockResolvedValue({ id: 'plink_1', short_url: 'https://rzp.io/i/abc' });

    await expect(service.createPaymentLinkForOrder('order-1')).resolves.toBeDefined();
  });

  it('creates a Payment Link for the exact pending amount and stashes the link id as transactionRef', async () => {
    const { service, prisma, razorpay } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PP1234',
      payment: { id: 'pay-1', status: 'PENDING', amountRs: 149 },
    });
    razorpay.createPaymentLink.mockResolvedValue({ id: 'plink_1', short_url: 'https://rzp.io/i/abc123' });

    const result = await service.createPaymentLinkForOrder('order-1');

    expect(razorpay.createPaymentLink).toHaveBeenCalledWith({ amountRs: 149, orderId: 'order-1', orderNumber: 'PP1234' });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { transactionRef: 'plink_1' },
    });
    expect(result).toEqual(
      expect.objectContaining({ paymentLinkId: 'plink_1', shortUrl: 'https://rzp.io/i/abc123', orderNumber: 'PP1234' }),
    );
  });
});

describe('PaymentsService.confirmPayment', () => {
  const params = { razorpayOrderId: 'order_rzp_1', razorpayPaymentId: 'pay_rzp_1', razorpaySignature: 'sig' };

  it('rejects when the signature does not verify — never trusts the client callback alone', async () => {
    const { service, razorpay, prisma } = makeHarness();
    razorpay.verifySignature.mockReturnValue(false);

    await expect(service.confirmPayment('cust-1', params)).rejects.toThrow(BadRequestException);
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('throws NotFoundException if no payment matches the gateway order id', async () => {
    const { service, razorpay, prisma } = makeHarness();
    razorpay.verifySignature.mockReturnValue(true);
    prisma.payment.findFirst.mockResolvedValue(null);

    await expect(service.confirmPayment('cust-1', params)).rejects.toThrow(NotFoundException);
  });

  it('refuses to confirm a payment belonging to a different customer', async () => {
    const { service, razorpay, prisma } = makeHarness();
    razorpay.verifySignature.mockReturnValue(true);
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: 'PENDING',
      order: { id: 'order-1', customerId: 'cust-OTHER' },
    });

    await expect(service.confirmPayment('cust-1', params)).rejects.toThrow(ForbiddenException);
  });

  it('is idempotent — confirming an already-PAID payment again does not re-grant rewards', async () => {
    const { service, razorpay, prisma, orders } = makeHarness();
    razorpay.verifySignature.mockReturnValue(true);
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: 'PAID',
      order: { id: 'order-1', customerId: 'cust-1' },
    });

    const result = await service.confirmPayment('cust-1', params);

    expect(result).toEqual({ alreadyConfirmed: true, orderId: 'order-1' });
    expect(orders.grantOrderRewards).not.toHaveBeenCalled();
  });

  it('marks the payment PAID and grants order rewards only after a verified confirmation', async () => {
    const { service, razorpay, prisma, orders, gateway, notificationQueue } = makeHarness();
    razorpay.verifySignature.mockReturnValue(true);
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: 'PENDING',
      order: { id: 'order-1', orderNumber: 'PP1234', customerId: 'cust-1', status: 'RECEIVED', totalProteinG: 30, totalRs: 149 },
    });

    const result = await service.confirmPayment('cust-1', params);

    expect(orders.grantOrderRewards).toHaveBeenCalledWith(expect.anything(), 'order-1', 'cust-1', 30, 149);
    expect(gateway.emitOrderStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', customerId: 'cust-1' }),
    );
    expect(notificationQueue.queueInvoiceEmail).toHaveBeenCalledWith('order-1');
    expect(result).toEqual({ alreadyConfirmed: false, orderId: 'order-1' });
  });

  it('does not send an e-bill when confirming an already-PAID payment again', async () => {
    const { service, razorpay, prisma, notificationQueue } = makeHarness();
    razorpay.verifySignature.mockReturnValue(true);
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: 'PAID',
      order: { id: 'order-1', customerId: 'cust-1' },
    });

    await service.confirmPayment('cust-1', params);

    expect(notificationQueue.queueInvoiceEmail).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.confirmPaymentFromWebhook', () => {
  it('throws NotFoundException if no payment matches the gateway order id', async () => {
    const { service, prisma } = makeHarness();
    prisma.payment.findFirst.mockResolvedValue(null);

    await expect(service.confirmPaymentFromWebhook('order_rzp_1', 'pay_rzp_1')).rejects.toThrow(NotFoundException);
  });

  it('never checks customer ownership — this is a trusted server-to-server call, not a request from any particular user', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: 'PENDING',
      order: { id: 'order-1', orderNumber: 'PP1234', customerId: 'cust-SOMEONE', status: 'RECEIVED', totalProteinG: 30, totalRs: 149 },
    });

    const result = await service.confirmPaymentFromWebhook('order_rzp_1', 'pay_rzp_1');

    expect(orders.grantOrderRewards).toHaveBeenCalledWith(expect.anything(), 'order-1', 'cust-SOMEONE', 30, 149);
    expect(result).toEqual({ alreadyConfirmed: false, orderId: 'order-1' });
  });

  it('is idempotent — a duplicate webhook delivery for an already-PAID payment does not re-grant rewards', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: 'PAID',
      order: { id: 'order-1', customerId: 'cust-1' },
    });

    const result = await service.confirmPaymentFromWebhook('order_rzp_1', 'pay_rzp_1');

    expect(result).toEqual({ alreadyConfirmed: true, orderId: 'order-1' });
    expect(orders.grantOrderRewards).not.toHaveBeenCalled();
  });

  it('marks the payment PAID and sends the e-bill, exactly like the customer-callback path', async () => {
    const { service, prisma, notificationQueue } = makeHarness();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: 'PENDING',
      order: { id: 'order-1', orderNumber: 'PP1234', customerId: 'cust-1', status: 'RECEIVED', totalProteinG: 30, totalRs: 149 },
    });

    await service.confirmPaymentFromWebhook('order_rzp_1', 'pay_rzp_1');

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: 'PAID', paidAt: expect.any(Date), transactionRef: 'pay_rzp_1' },
    });
    expect(notificationQueue.queueInvoiceEmail).toHaveBeenCalledWith('order-1');
  });
});
