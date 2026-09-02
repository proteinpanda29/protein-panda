import { BadRequestException } from '@nestjs/common';
import { RefundsService } from './refunds.service';

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'PP1234',
    customerId: 'cust-1',
    status: 'RECEIVED',
    refundedRs: 0,
    items: [{ productId: 'p1', quantity: 2 }],
    payment: { id: 'pay-1', method: 'CASH', status: 'PENDING', amountRs: 149, transactionRef: null },
    ...overrides,
  };
}

function makeHarness() {
  const prisma: any = {
    order: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    payment: { update: jest.fn() },
    refund: { create: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    pointsLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
  };
  prisma.$transaction = jest.fn().mockImplementation((cb: any) => cb(prisma));

  const points = { award: jest.fn().mockResolvedValue(undefined) } as any;
  const inventory = { restockForOrder: jest.fn().mockResolvedValue(undefined) } as any;
  const razorpay = { refundPayment: jest.fn() } as any;
  const wallet = { credit: jest.fn().mockResolvedValue(undefined) } as any;
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const businessDayLock = { assertNotClosed: jest.fn().mockResolvedValue(undefined), isTodayClosed: jest.fn().mockResolvedValue(false) } as any;

  const service = new RefundsService(prisma, points, inventory, razorpay, wallet, auditLog, businessDayLock);
  return { service, prisma, points, inventory, razorpay, wallet, auditLog, businessDayLock };
}

describe('RefundsService.cancelOrder', () => {
  it('rejects when a customer tries to cancel an order that is not theirs', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ customerId: 'cust-OTHER' }));

    await expect(
      service.cancelOrder('order-1', { reason: 'changed my mind', isCustomerInitiated: true, customerId: 'cust-1' }),
    ).rejects.toThrow(/does not belong to you/);
  });

  it('rejects cancelling an already-cancelled order', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ status: 'CANCELLED' }));

    await expect(
      service.cancelOrder('order-1', { reason: 'x', isCustomerInitiated: false }),
    ).rejects.toThrow(/already cancelled/);
  });

  it('rejects cancelling a delivered order — must use a refund instead', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ status: 'DELIVERED' }));

    await expect(
      service.cancelOrder('order-1', { reason: 'x', isCustomerInitiated: false }),
    ).rejects.toThrow(/process a refund instead/);
  });

  it('rejects customer self-cancellation once the kitchen has started preparing', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ status: 'PREPARING' }));

    await expect(
      service.cancelOrder('order-1', { reason: 'x', isCustomerInitiated: true, customerId: 'cust-1' }),
    ).rejects.toThrow(/no longer be self-cancelled/);
  });

  it('allows admin to cancel an order in PREPARING (no self-cancel restriction for admin)', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ status: 'PREPARING' }));

    await expect(
      service.cancelOrder('order-1', { reason: 'kitchen ran out', isCustomerInitiated: false }),
    ).resolves.toEqual({ cancelled: true, refund: null });
  });

  it('requires a non-empty reason', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder());

    await expect(
      service.cancelOrder('order-1', { reason: '  ', isCustomerInitiated: false }),
    ).rejects.toThrow(/reason is required/);
  });

  it('always restocks inventory on cancellation, regardless of payment status', async () => {
    const { service, prisma, inventory } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ payment: { ...makeOrder().payment, status: 'PENDING' } }));

    await service.cancelOrder('order-1', { reason: 'x', isCustomerInitiated: false });

    expect(inventory.restockForOrder).toHaveBeenCalledWith(expect.anything(), 'order-1', [{ productId: 'p1', quantity: 2 }]);
  });

  it('does NOT reverse points when payment was never confirmed — none were granted in the first place', async () => {
    const { service, prisma, points } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ payment: { ...makeOrder().payment, status: 'PENDING' } }));

    await service.cancelOrder('order-1', { reason: 'x', isCustomerInitiated: false });

    expect(points.award).not.toHaveBeenCalled();
  });

  it('reverses exactly the points that were granted for this order when payment was confirmed', async () => {
    const { service, prisma, points } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ payment: { ...makeOrder().payment, status: 'PAID' } }));
    prisma.pointsLedgerEntry.findMany.mockResolvedValue([{ points: 15 }, { points: 500 }]); // purchase + goal bonus

    await service.cancelOrder('order-1', { reason: 'x', isCustomerInitiated: false });

    expect(points.award).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customerId: 'cust-1', points: -515, sourceType: 'REFUND_REVERSAL', orderId: 'order-1' }),
    );
  });

  it('does not call points.award at all if the order earned zero points', async () => {
    const { service, prisma, points } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ payment: { ...makeOrder().payment, status: 'PAID' } }));
    prisma.pointsLedgerEntry.findMany.mockResolvedValue([]);

    await service.cancelOrder('order-1', { reason: 'x', isCustomerInitiated: false });

    expect(points.award).not.toHaveBeenCalled();
  });

  it('triggers a refund for the paid amount when payment was confirmed', async () => {
    const { service, prisma, razorpay } = makeHarness();
    const order = makeOrder({ payment: { id: 'pay-1', method: 'CASH', status: 'PAID', amountRs: 149, transactionRef: null } });
    prisma.order.findUniqueOrThrow
      .mockResolvedValueOnce(order) // cancelOrder's own lookup
      .mockResolvedValueOnce(order); // processRefund's internal lookup
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', method: 'CASH', amountRs: 149 });

    const result = await service.cancelOrder('order-1', { reason: 'x', isCustomerInitiated: false });

    expect(prisma.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderId: 'order-1', amountRs: 149 }) }),
    );
    expect(result.refund).toEqual({ id: 'refund-1', method: 'CASH', amountRs: 149 });
    expect(razorpay.refundPayment).not.toHaveBeenCalled(); // CASH doesn't hit the gateway
  });

  it('does not attempt a refund if nothing was ever paid', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ payment: { ...makeOrder().payment, status: 'PENDING' } }));

    const result = await service.cancelOrder('order-1', { reason: 'x', isCustomerInitiated: false });

    expect(result.refund).toBeNull();
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });
});

describe('RefundsService.processRefund', () => {
  it('rejects a zero or negative amount', async () => {
    const { service } = makeHarness();
    await expect(service.processRefund('order-1', 'admin-1', { amountRs: 0, reason: 'x' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a missing reason', async () => {
    const { service } = makeHarness();
    await expect(service.processRefund('order-1', 'admin-1', { amountRs: 50, reason: '' })).rejects.toThrow(
      /reason is required/,
    );
  });

  it('rejects refunding an order that was never paid', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ payment: { ...makeOrder().payment, status: 'PENDING' } }));

    await expect(service.processRefund('order-1', 'admin-1', { amountRs: 50, reason: 'x' })).rejects.toThrow(
      /nothing to refund/,
    );
  });

  it('rejects refunding more than the remaining refundable amount', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ refundedRs: 100, payment: { id: 'pay-1', method: 'CASH', status: 'PAID', amountRs: 149, transactionRef: null } }),
    );

    await expect(service.processRefund('order-1', 'admin-1', { amountRs: 60, reason: 'x' })).rejects.toThrow(
      /remaining refundable amount/,
    );
  });

  it('a CASH refund is created but stays PENDING until manually confirmed', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ payment: { id: 'pay-1', method: 'CASH', status: 'PAID', amountRs: 149, transactionRef: null } }),
    );
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', status: 'PENDING', method: 'CASH' });

    const result = await service.processRefund('order-1', 'admin-1', { amountRs: 149, reason: 'x' });

    expect(result).toEqual({ id: 'refund-1', status: 'PENDING', method: 'CASH' });
    expect(prisma.refund.update).not.toHaveBeenCalled(); // completeRefund never ran
  });

  it('records a real audit log entry with the amount, method, and reason', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ orderNumber: 'PP0042', payment: { id: 'pay-1', method: 'CASH', status: 'PAID', amountRs: 149, transactionRef: null } }),
    );
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', status: 'PENDING', method: 'CASH' });

    await service.processRefund('order-1', 'admin-1', { amountRs: 100, reason: 'Item was cold' });

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'ORDER_REFUNDED',
        entityType: 'Order',
        entityId: 'order-1',
        summary: expect.stringContaining('₹100'),
        metadata: { amountRs: 100, method: 'CASH', reason: 'Item was cold' },
      }),
    );
  });

  it('refuses an admin-initiated refund once today\'s business day has been closed', async () => {
    const { service, businessDayLock } = makeHarness();
    businessDayLock.assertNotClosed.mockRejectedValue(new Error("Today's business day has been closed"));

    await expect(service.processRefund('order-1', 'admin-1', { amountRs: 100, reason: 'x' })).rejects.toThrow(/business day has been closed/);
  });

  it('never checks the business day lock at all for a customer\'s own self-cancellation refund path (no admin user)', async () => {
    const { service, prisma, businessDayLock } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ payment: { id: 'pay-1', method: 'CASH', status: 'PAID', amountRs: 149, transactionRef: null } }),
    );
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', status: 'PENDING', method: 'CASH' });

    await service.processRefund('order-1', undefined, { amountRs: 100, reason: 'x' });

    expect(businessDayLock.assertNotClosed).not.toHaveBeenCalled();
  });

  it('does not attempt to log anything when no admin user is given at all', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ payment: { id: 'pay-1', method: 'CASH', status: 'PAID', amountRs: 149, transactionRef: null } }),
    );
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', status: 'PENDING', method: 'CASH' });

    await service.processRefund('order-1', undefined, { amountRs: 100, reason: 'x' });

    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('an online refund calls Razorpay and completes immediately on success', async () => {
    const { service, prisma, razorpay } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ payment: { id: 'pay-1', method: 'UPI', status: 'PAID', amountRs: 149, transactionRef: 'pay_rzp_1' } }),
    );
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', method: 'RAZORPAY' });
    razorpay.refundPayment.mockResolvedValue({ id: 'rfnd_abc123' });
    prisma.refund.update.mockResolvedValue({
      id: 'refund-1',
      orderId: 'order-1',
      amountRs: 149,
      order: { refundedRs: 0, payment: { id: 'pay-1', amountRs: 149 } },
    });

    await service.processRefund('order-1', 'admin-1', { amountRs: 149, reason: 'customer complaint' });

    expect(razorpay.refundPayment).toHaveBeenCalledWith('pay_rzp_1', 149);
    expect(prisma.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', razorpayRefundId: 'rfnd_abc123' }) }),
    );
  });

  it('an admin-chosen WALLET refund completes instantly and credits the wallet — no gateway call, no PENDING state to wait on', async () => {
    const { service, prisma, razorpay, wallet } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ payment: { id: 'pay-1', method: 'UPI', status: 'PAID', amountRs: 149, transactionRef: 'pay_rzp_1' } }),
    );
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', method: 'WALLET' });
    prisma.refund.update.mockResolvedValue({
      id: 'refund-1',
      orderId: 'order-1',
      amountRs: 149,
      method: 'WALLET',
      order: { refundedRs: 0, payment: { id: 'pay-1', amountRs: 149 }, customerId: 'cust-1', orderNumber: 'PP1234' },
    });

    await service.processRefund('order-1', 'admin-1', { amountRs: 149, reason: 'customer complaint', method: 'WALLET' });

    expect(razorpay.refundPayment).not.toHaveBeenCalled();
    expect(wallet.credit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ customerId: 'cust-1', amountRs: 149, type: 'REFUND', orderId: 'order-1', refundId: 'refund-1' }),
    );
    expect(prisma.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
  });

  it('an explicit WALLET choice overrides what would have been auto-derived from the original payment method', async () => {
    const { service, prisma } = makeHarness();
    // Originally paid CASH — would normally auto-derive to a CASH
    // refund, but the admin explicitly chose WALLET instead.
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ payment: { id: 'pay-1', method: 'CASH', status: 'PAID', amountRs: 149, transactionRef: null } }),
    );
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', method: 'WALLET' });
    prisma.refund.update.mockResolvedValue({
      id: 'refund-1', orderId: 'order-1', amountRs: 149, method: 'WALLET',
      order: { refundedRs: 0, payment: { id: 'pay-1', amountRs: 149 }, customerId: 'cust-1', orderNumber: 'PP1234' },
    });

    await service.processRefund('order-1', 'admin-1', { amountRs: 149, reason: 'goodwill', method: 'WALLET' });

    expect(prisma.refund.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ method: 'WALLET' }) }));
  });

  it('marks the refund FAILED and throws if the gateway call fails — never silently succeeds', async () => {
    const { service, prisma, razorpay } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ payment: { id: 'pay-1', method: 'UPI', status: 'PAID', amountRs: 149, transactionRef: 'pay_rzp_1' } }),
    );
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', method: 'RAZORPAY' });
    razorpay.refundPayment.mockRejectedValue(new Error('gateway timeout'));

    await expect(service.processRefund('order-1', 'admin-1', { amountRs: 149, reason: 'x' })).rejects.toThrow(
      /failed at the payment gateway/,
    );
    expect(prisma.refund.update).toHaveBeenCalledWith({ where: { id: 'refund-1' }, data: { status: 'FAILED' } });
  });

  it('marks the Payment REFUNDED once the cumulative refunded amount reaches the full paid amount', async () => {
    const { service, prisma, razorpay } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ payment: { id: 'pay-1', method: 'UPI', status: 'PAID', amountRs: 149, transactionRef: 'pay_rzp_1' } }),
    );
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', method: 'RAZORPAY' });
    razorpay.refundPayment.mockResolvedValue({ id: 'rfnd_1' });
    prisma.refund.update.mockResolvedValue({
      id: 'refund-1',
      orderId: 'order-1',
      amountRs: 149,
      order: { refundedRs: 0, payment: { id: 'pay-1', amountRs: 149 } },
    });

    await service.processRefund('order-1', 'admin-1', { amountRs: 149, reason: 'x' });

    expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'pay-1' }, data: { status: 'REFUNDED' } });
  });

  it('leaves the Payment PAID (not REFUNDED) after only a partial refund', async () => {
    const { service, prisma, razorpay } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ payment: { id: 'pay-1', method: 'UPI', status: 'PAID', amountRs: 149, transactionRef: 'pay_rzp_1' } }),
    );
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', method: 'RAZORPAY' });
    razorpay.refundPayment.mockResolvedValue({ id: 'rfnd_1' });
    prisma.refund.update.mockResolvedValue({
      id: 'refund-1',
      orderId: 'order-1',
      amountRs: 50,
      order: { refundedRs: 0, payment: { id: 'pay-1', amountRs: 149 } },
    });

    await service.processRefund('order-1', 'admin-1', { amountRs: 50, reason: 'partial goodwill refund' });

    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});

describe('RefundsService.confirmCashRefund', () => {
  it('rejects confirming a non-CASH refund', async () => {
    const { service, prisma } = makeHarness();
    prisma.refund.findUniqueOrThrow.mockResolvedValue({ id: 'refund-1', method: 'RAZORPAY', status: 'PENDING' });

    await expect(service.confirmCashRefund('refund-1')).rejects.toThrow(/Only cash refunds/);
  });

  it('rejects confirming a refund that is not PENDING', async () => {
    const { service, prisma } = makeHarness();
    prisma.refund.findUniqueOrThrow.mockResolvedValue({ id: 'refund-1', method: 'CASH', status: 'COMPLETED' });

    await expect(service.confirmCashRefund('refund-1')).rejects.toThrow(/not pending/);
  });

  it('completes the refund and updates the order/payment state', async () => {
    const { service, prisma } = makeHarness();
    prisma.refund.findUniqueOrThrow.mockResolvedValue({ id: 'refund-1', method: 'CASH', status: 'PENDING' });
    prisma.refund.update.mockResolvedValue({
      id: 'refund-1',
      orderId: 'order-1',
      amountRs: 149,
      order: { refundedRs: 0, payment: { id: 'pay-1', amountRs: 149 } },
    });

    await service.confirmCashRefund('refund-1');

    expect(prisma.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'refund-1' }, data: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
    expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'pay-1' }, data: { status: 'REFUNDED' } });
  });
});
