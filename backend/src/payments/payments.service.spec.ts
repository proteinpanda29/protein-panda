import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

function makeHarness() {
  const prisma: any = {
    order: { findUniqueOrThrow: jest.fn() },
    payment: { update: jest.fn(), findFirst: jest.fn() },
    customer: { findUnique: jest.fn() },
    deliveryOrder: { findUnique: jest.fn(), update: jest.fn() },
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
  const notificationQueue = { queueInvoiceEmail: jest.fn().mockResolvedValue(undefined), queueWhatsAppNotification: jest.fn().mockResolvedValue(undefined) } as any;

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

    expect(razorpay.createPaymentLink).toHaveBeenCalledWith({ amountRs: 149, referenceId: 'order-1', description: 'Order PP1234' });
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

  it('sends a WhatsApp payment-confirmation template when configured and the customer has a phone', async () => {
    process.env.WHATSAPP_AUTH_KEY = 'test-key';
    process.env.WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED = 'payment_confirmed';

    const { service, prisma, notificationQueue } = makeHarness();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: 'PENDING',
      order: { id: 'order-1', orderNumber: 'PP1234', customerId: 'cust-1', status: 'RECEIVED', totalProteinG: 30, totalRs: 149 },
    });
    prisma.customer.findUnique.mockResolvedValue({ user: { phone: '+919876543210' } });

    await service.confirmPaymentFromWebhook('order_rzp_1', 'pay_rzp_1');
    await new Promise((resolve) => setImmediate(resolve)); // let the un-awaited .then() chain settle

    expect(notificationQueue.queueWhatsAppNotification).toHaveBeenCalledWith('+919876543210', 'payment_confirmed', ['PP1234', 'Rs 149']);

    delete process.env.WHATSAPP_AUTH_KEY;
    delete process.env.WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED;
  });

  it('does not attempt a WhatsApp send when the template env var is not configured', async () => {
    delete process.env.WHATSAPP_AUTH_KEY;
    delete process.env.WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED;

    const { service, prisma, notificationQueue } = makeHarness();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: 'PENDING',
      order: { id: 'order-1', orderNumber: 'PP1234', customerId: 'cust-1', status: 'RECEIVED', totalProteinG: 30, totalRs: 149 },
    });

    await service.confirmPaymentFromWebhook('order_rzp_1', 'pay_rzp_1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(notificationQueue.queueWhatsAppNotification).not.toHaveBeenCalled();
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it('skips the WhatsApp send gracefully when the customer has no phone on file, without throwing', async () => {
    process.env.WHATSAPP_AUTH_KEY = 'test-key';
    process.env.WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED = 'payment_confirmed';

    const { service, prisma, notificationQueue } = makeHarness();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: 'PENDING',
      order: { id: 'order-1', orderNumber: 'PP1234', customerId: 'cust-1', status: 'RECEIVED', totalProteinG: 30, totalRs: 149 },
    });
    prisma.customer.findUnique.mockResolvedValue({ user: { phone: null } });

    await expect(service.confirmPaymentFromWebhook('order_rzp_1', 'pay_rzp_1')).resolves.toBeDefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(notificationQueue.queueWhatsAppNotification).not.toHaveBeenCalled();

    delete process.env.WHATSAPP_AUTH_KEY;
    delete process.env.WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED;
  });
});

describe('PaymentsService.createTipPaymentLink', () => {
  it('creates a real Razorpay Payment Link encoding the delivery order id and amount in its reference_id', async () => {
    const { service, prisma, razorpay } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PP1234',
      customerId: 'cust-1',
      status: 'DELIVERED',
      deliveryOrder: { id: 'delivery-1', tipAmountRs: 0 },
    });
    razorpay.createPaymentLink.mockResolvedValue({ id: 'plink_tip_1', short_url: 'https://rzp.io/i/tip123' });

    const result = await service.createTipPaymentLink('cust-1', 'order-1', 30);

    expect(razorpay.createPaymentLink).toHaveBeenCalledWith({
      amountRs: 30,
      referenceId: 'tip:delivery-1:30',
      description: 'Tip for order PP1234',
    });
    expect(result).toEqual({ paymentLinkId: 'plink_tip_1', shortUrl: 'https://rzp.io/i/tip123' });
  });

  it('rejects a tip amount that is not positive', async () => {
    const { service } = makeHarness();
    await expect(service.createTipPaymentLink('cust-1', 'order-1', 0)).rejects.toThrow(/must be positive/i);
  });

  it('refuses to create a tip link for someone else\'s order', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      customerId: 'someone-else',
      status: 'DELIVERED',
      deliveryOrder: { id: 'delivery-1', tipAmountRs: 0 },
    });

    await expect(service.createTipPaymentLink('cust-1', 'order-1', 30)).rejects.toThrow(/does not belong to you/i);
  });

  it('refuses to create a tip link before the order has actually been delivered', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      customerId: 'cust-1',
      status: 'OUT_FOR_DELIVERY',
      deliveryOrder: { id: 'delivery-1', tipAmountRs: 0 },
    });

    await expect(service.createTipPaymentLink('cust-1', 'order-1', 30)).rejects.toThrow(/after your order has been delivered/i);
  });

  it('refuses to create a second tip link once a tip has already been applied', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      customerId: 'cust-1',
      status: 'DELIVERED',
      deliveryOrder: { id: 'delivery-1', tipAmountRs: 20 },
    });

    await expect(service.createTipPaymentLink('cust-1', 'order-1', 30)).rejects.toThrow(/already tipped/i);
  });
});

describe('PaymentsService.confirmTipPayment', () => {
  it('applies the tip amount to the correct delivery order', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUnique.mockResolvedValue({ id: 'delivery-1', tipAmountRs: 0 });

    await service.confirmTipPayment('delivery-1', 30);

    expect(prisma.deliveryOrder.update).toHaveBeenCalledWith({ where: { id: 'delivery-1' }, data: { tipAmountRs: 30 } });
  });

  it('is idempotent — does not double-apply a tip on a duplicate webhook delivery', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUnique.mockResolvedValue({ id: 'delivery-1', tipAmountRs: 30 });

    await service.confirmTipPayment('delivery-1', 30);

    expect(prisma.deliveryOrder.update).not.toHaveBeenCalled();
  });

  it('does nothing and does not throw when the delivery order no longer exists', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUnique.mockResolvedValue(null);

    await expect(service.confirmTipPayment('ghost-delivery', 30)).resolves.toBeUndefined();
    expect(prisma.deliveryOrder.update).not.toHaveBeenCalled();
  });
});
