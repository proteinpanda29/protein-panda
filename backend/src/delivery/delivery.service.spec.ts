import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DeliveryService } from './delivery.service';

function makeHarness() {
  const prisma = {
    deliveryOrder: { findMany: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    deliveryPerson: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ name: 'Test Rider' }) },
    order: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    payment: { update: jest.fn() },
    $transaction: jest.fn().mockImplementation((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  } as any;
  const gateway = { emitOrderStatusUpdate: jest.fn(), emitDeliveryLocationUpdate: jest.fn() } as any;
  const orders = { grantOrderRewards: jest.fn().mockResolvedValue(undefined), notifyStatusChange: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new DeliveryService(prisma, gateway, orders);
  return { service, prisma, gateway, orders };
}

describe('DeliveryService.myAssignedOrders', () => {
  it('strips deliveryOtp before it ever reaches the rider — they verify a code, they never see it', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findMany.mockResolvedValue([
      { id: 'do-1', deliveryOtp: '4821', address: '2nd floor', order: { orderNumber: 'PP1234' } },
    ]);

    const result = await service.myAssignedOrders('rider-1');

    expect(result[0]).not.toHaveProperty('deliveryOtp');
    expect(result[0].address).toBe('2nd floor');
  });

  it('only queries orders assigned to this specific rider', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findMany.mockResolvedValue([]);

    await service.myAssignedOrders('rider-1');

    expect(prisma.deliveryOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deliveryPersonId: 'rider-1' } }),
    );
  });
});

describe('DeliveryService.updateLiveLocation', () => {
  it('refuses to update location for an order not assigned to this rider', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({
      deliveryPersonId: 'rider-OTHER',
      order: { id: 'order-1', customerId: 'cust-1', status: 'OUT_FOR_DELIVERY' },
    });

    await expect(service.updateLiveLocation('rider-1', 'do-1', 12.9, 77.6)).rejects.toThrow(ForbiddenException);
  });

  it('refuses a location ping before the order is actually out for delivery', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({
      deliveryPersonId: 'rider-1',
      order: { id: 'order-1', customerId: 'cust-1', status: 'ASSIGNED' },
    });

    await expect(service.updateLiveLocation('rider-1', 'do-1', 12.9, 77.6)).rejects.toThrow(BadRequestException);
  });

  it('broadcasts the location only to the customer room and admin — never to other riders', async () => {
    const { service, prisma, gateway } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({
      deliveryPersonId: 'rider-1',
      order: { id: 'order-1', customerId: 'cust-1', status: 'OUT_FOR_DELIVERY' },
    });

    await service.updateLiveLocation('rider-1', 'do-1', 12.9, 77.6);

    expect(gateway.emitDeliveryLocationUpdate).toHaveBeenCalledWith({
      orderId: 'order-1',
      customerId: 'cust-1',
      lat: 12.9,
      lng: 77.6,
    });
  });
});

describe('DeliveryService.updateDeliveryStatus', () => {
  it('rejects an unknown action', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-1', orderId: 'order-1' });

    await expect(service.updateDeliveryStatus('rider-1', 'do-1', 'TELEPORTED')).rejects.toThrow(BadRequestException);
  });

  it('refuses to update an order not assigned to this rider', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-OTHER', orderId: 'order-1' });

    await expect(service.updateDeliveryStatus('rider-1', 'do-1', 'PICKED_UP')).rejects.toThrow(ForbiddenException);
  });

  it('PICKED_UP only timestamps the DeliveryOrder — does not touch Order.status', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-1', orderId: 'order-1' });

    await service.updateDeliveryStatus('rider-1', 'do-1', 'PICKED_UP');

    expect(prisma.deliveryOrder.update).toHaveBeenCalledWith({
      where: { id: 'do-1' },
      data: { pickedUpAt: expect.any(Date) },
    });
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('OUT_FOR_DELIVERY updates both the DeliveryOrder timestamp and Order.status, and broadcasts it', async () => {
    const { service, prisma, gateway } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-1', orderId: 'order-1' });
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PP1234',
      status: 'OUT_FOR_DELIVERY',
      customerId: 'cust-1',
      payment: { method: 'UPI', status: 'PAID' },
    });

    await service.updateDeliveryStatus('rider-1', 'do-1', 'OUT_FOR_DELIVERY');

    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'order-1' }, data: { status: 'OUT_FOR_DELIVERY' } });
    expect(gateway.emitOrderStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', status: 'OUT_FOR_DELIVERY', deliveryPersonId: 'rider-1' }),
    );
  });

  it('notifies the customer with the real rider\'s name when the order goes out for delivery', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-1', orderId: 'order-1' });
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1', orderNumber: 'PP1234', status: 'OUT_FOR_DELIVERY', customerId: 'cust-1', payment: { method: 'UPI', status: 'PAID' },
    });
    prisma.deliveryPerson.findUnique.mockResolvedValue({ name: 'Siva' });

    await service.updateDeliveryStatus('rider-1', 'do-1', 'OUT_FOR_DELIVERY');

    expect(orders.notifyStatusChange).toHaveBeenCalledWith('order-1', 'OUT_FOR_DELIVERY', 'Siva');
  });

  it('DELIVERED with an already-PAID (online) payment does not grant rewards again', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-1', orderId: 'order-1', deliveryOtp: '4821' });
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PP1234',
      status: 'DELIVERED',
      customerId: 'cust-1',
      payment: { id: 'pay-1', method: 'UPI', status: 'PAID' },
    });

    await service.updateDeliveryStatus('rider-1', 'do-1', 'DELIVERED', '4821');

    expect(orders.grantOrderRewards).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('DELIVERED with a still-PENDING cash payment collects it and grants rewards exactly once (this is the correct single reward-grant point for a self-checkout cash delivery order)', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-1', orderId: 'order-1', deliveryOtp: '4821' });
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PP1234',
      status: 'DELIVERED',
      customerId: 'cust-1',
      totalProteinG: 30,
      totalRs: 149,
      payment: { id: 'pay-1', method: 'CASH', status: 'PENDING' },
    });

    await service.updateDeliveryStatus('rider-1', 'do-1', 'DELIVERED', '4821');

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
    expect(orders.grantOrderRewards).toHaveBeenCalledTimes(1);
    expect(orders.grantOrderRewards).toHaveBeenCalledWith(expect.anything(), 'order-1', 'cust-1', 30, 149);
  });

  it('rejects DELIVERED when no OTP is provided', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-1', orderId: 'order-1', deliveryOtp: '4821' });

    await expect(service.updateDeliveryStatus('rider-1', 'do-1', 'DELIVERED')).rejects.toThrow(/Incorrect delivery code/);
  });

  it('rejects DELIVERED when the OTP does not match', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-1', orderId: 'order-1', deliveryOtp: '4821' });

    await expect(service.updateDeliveryStatus('rider-1', 'do-1', 'DELIVERED', '0000')).rejects.toThrow(/Incorrect delivery code/);
  });

  it('rejects DELIVERED entirely if the order somehow has no OTP on record — never silently skips the check', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-1', orderId: 'order-1', deliveryOtp: null });

    await expect(service.updateDeliveryStatus('rider-1', 'do-1', 'DELIVERED', '4821')).rejects.toThrow(/no delivery code on record/);
  });

  it('ARRIVED updates both the DeliveryOrder timestamp and Order.status, and broadcasts it', async () => {
    const { service, prisma, gateway } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({ deliveryPersonId: 'rider-1', orderId: 'order-1' });
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PP1234',
      status: 'ARRIVED',
      customerId: 'cust-1',
      payment: { method: 'UPI', status: 'PAID' },
    });

    await service.updateDeliveryStatus('rider-1', 'do-1', 'ARRIVED');

    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'order-1' }, data: { status: 'ARRIVED' } });
    expect(gateway.emitOrderStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', status: 'ARRIVED' }),
    );
  });
});

describe('DeliveryService.reportDeliveryFailure', () => {
  it('rejects a missing reason', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({
      deliveryPersonId: 'rider-1',
      orderId: 'order-1',
      order: { status: 'OUT_FOR_DELIVERY' },
    });

    await expect(service.reportDeliveryFailure('rider-1', 'do-1', '')).rejects.toThrow(/reason is required/);
  });

  it('refuses to report a failure for an order not assigned to this rider', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({
      deliveryPersonId: 'rider-OTHER',
      orderId: 'order-1',
      order: { status: 'OUT_FOR_DELIVERY' },
    });

    await expect(service.reportDeliveryFailure('rider-1', 'do-1', 'CUSTOMER_UNAVAILABLE')).rejects.toThrow(ForbiddenException);
  });

  it('rejects reporting a failure for an order that has already been delivered', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({
      deliveryPersonId: 'rider-1',
      orderId: 'order-1',
      order: { status: 'DELIVERED' },
    });

    await expect(service.reportDeliveryFailure('rider-1', 'do-1', 'CUSTOMER_UNAVAILABLE')).rejects.toThrow(
      /Cannot report a failure/,
    );
  });

  it('marks the order FAILED with the reason and note, and broadcasts the update', async () => {
    const { service, prisma, gateway } = makeHarness();
    prisma.deliveryOrder.findUniqueOrThrow.mockResolvedValue({
      deliveryPersonId: 'rider-1',
      orderId: 'order-1',
      order: { status: 'OUT_FOR_DELIVERY' },
    });
    prisma.deliveryOrder.update.mockResolvedValue({});
    prisma.order.update.mockResolvedValue({ id: 'order-1', orderNumber: 'PP1234', status: 'FAILED', customerId: 'cust-1' });

    await service.reportDeliveryFailure('rider-1', 'do-1', 'CUSTOMER_UNAVAILABLE', 'No answer after 3 calls');

    expect(prisma.deliveryOrder.update).toHaveBeenCalledWith({
      where: { id: 'do-1' },
      data: { failureReason: 'CUSTOMER_UNAVAILABLE', failureNote: 'No answer after 3 calls', failedAt: expect.any(Date) },
    });
    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'order-1' }, data: { status: 'FAILED' } });
    expect(gateway.emitOrderStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', status: 'FAILED', deliveryPersonId: 'rider-1' }),
    );
  });
});

describe('DeliveryService.getProfile', () => {
  it('returns the rider profile including current duty status — the frontend needs this on page load, otherwise it can only guess a stale default (regression: this endpoint did not exist, so the duty toggle UI always showed "Off Duty" on refresh regardless of the real state)', async () => {
    const { service, prisma } = makeHarness();
    prisma.deliveryPerson.findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'rider-1', isOnDuty: true });

    const result = await service.getProfile('rider-1');

    expect(prisma.deliveryPerson.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'rider-1' } });
    expect(result).toEqual({ id: 'rider-1', isOnDuty: true });
  });
});
