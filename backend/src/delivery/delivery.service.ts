import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { OrdersGateway } from '../common/orders.gateway';
import { OrdersService } from '../orders/orders.service';

// Rider-facing actions. Note "PICKED_UP" is a delivery-side checkpoint only —
// it is not a value in the OrderStatus enum, so it updates the DeliveryOrder
// timestamp but does not touch Order.status. OUT_FOR_DELIVERY, ARRIVED, and
// DELIVERED map directly onto OrderStatus and update both records.
const ACTION_MAP: Record<
  string,
  { deliveryField: 'pickedUpAt' | 'outForDeliveryAt' | 'arrivedAt' | 'deliveredAt'; orderStatus?: string }
> = {
  PICKED_UP: { deliveryField: 'pickedUpAt' },
  OUT_FOR_DELIVERY: { deliveryField: 'outForDeliveryAt', orderStatus: 'OUT_FOR_DELIVERY' },
  ARRIVED: { deliveryField: 'arrivedAt', orderStatus: 'ARRIVED' },
  DELIVERED: { deliveryField: 'deliveredAt', orderStatus: 'DELIVERED' },
};

// A failure can only be reported once a rider has actually been assigned —
// reporting "rider issue" on an order still in the kitchen makes no sense.
const FAILURE_ELIGIBLE_STATUSES = ['ASSIGNED', 'OUT_FOR_DELIVERY', 'ARRIVED'];


@Injectable()
export class DeliveryService {
  constructor(
    private prisma: PrismaService,
    private gateway: OrdersGateway,
    private orders: OrdersService,
  ) {}

  // Only ever returns orders assigned to THIS delivery person —
  // no cross-visibility into other riders' orders or customer nutrition data.
  async myAssignedOrders(deliveryPersonId: string) {
    const records = await this.prisma.deliveryOrder.findMany({
      where: { deliveryPersonId },
      orderBy: { assignedAt: 'desc' },
      include: {
        order: {
          select: {
            orderNumber: true,
            status: true,
            totalRs: true,
            fulfillmentType: true,
            payment: { select: { status: true, method: true } },
            items: { select: { quantity: true, product: { select: { name: true } } } },
          },
        },
      },
    });

    // deliveryOtp is deliberately stripped before this ever reaches the
    // rider — the whole point of the handoff code is that the CUSTOMER
    // holds it and reads it out; a rider who could see the stored value
    // directly could mark an order delivered without ever actually
    // meeting the customer, which defeats the entire safeguard.
    return records.map(({ deliveryOtp, ...rest }: any) => rest);
  }

  async setDutyStatus(deliveryPersonId: string, isOnDuty: boolean) {
    return this.prisma.deliveryPerson.update({
      where: { id: deliveryPersonId },
      data: { isOnDuty },
    });
  }

  /**
   * Own profile, including current duty status. Without this, the
   * frontend has no way to know a rider's real on/off-duty state on
   * page load — it can only see it after the rider explicitly toggles
   * it, which means a page refresh (or a fresh login) always showed
   * "Off Duty" even for a rider who was genuinely still on duty.
   */
  async getProfile(deliveryPersonId: string) {
    return this.prisma.deliveryPerson.findUniqueOrThrow({ where: { id: deliveryPersonId } });
  }

  /**
   * Called frequently (e.g. every few seconds) while a rider has an
   * active OUT_FOR_DELIVERY order open. Persists the position (so a
   * customer opening the tracking page mid-delivery sees it immediately)
   * and broadcasts it live over the socket to that customer only.
   */
  async updateLiveLocation(deliveryPersonId: string, deliveryOrderId: string, lat: number, lng: number) {
    const record = await this.prisma.deliveryOrder.findUniqueOrThrow({
      where: { id: deliveryOrderId },
      include: { order: { select: { id: true, customerId: true, status: true } } },
    });
    if (record.deliveryPersonId !== deliveryPersonId) {
      throw new ForbiddenException('This order is not assigned to you');
    }
    // Only accept location pings once the order is actually out for
    // delivery — no reason to track before pickup or after drop-off.
    if (record.order.status !== 'OUT_FOR_DELIVERY') {
      throw new BadRequestException('Order is not currently out for delivery');
    }

    await this.prisma.deliveryOrder.update({
      where: { id: deliveryOrderId },
      data: { lastLat: lat, lastLng: lng, lastLocationAt: new Date() },
    });

    this.gateway.emitDeliveryLocationUpdate({
      orderId: record.order.id,
      customerId: record.order.customerId,
      lat,
      lng,
    });
  }

  async updateDeliveryStatus(deliveryPersonId: string, deliveryOrderId: string, action: string, otp?: string) {
    const mapped = ACTION_MAP[action];
    if (!mapped) throw new BadRequestException(`Unknown delivery action: ${action}`);

    const record = await this.prisma.deliveryOrder.findUniqueOrThrow({ where: { id: deliveryOrderId } });
    if (record.deliveryPersonId !== deliveryPersonId) {
      throw new ForbiddenException('This order is not assigned to you');
    }

    // The one real safeguard against "marked delivered but I never got
    // it" disputes: the rider must have the code the customer was shown,
    // not just tap a button. Checked here rather than trusting the
    // client to only call this action when it has a valid code.
    if (action === 'DELIVERED') {
      if (!record.deliveryOtp) {
        // Defensive — every DELIVERY order gets an OTP at creation (see
        // OrdersService.create). A missing one means something upstream
        // is broken, not that the check should be silently skipped.
        throw new BadRequestException('This order has no delivery code on record — contact support before marking delivered');
      }
      if (otp !== record.deliveryOtp) {
        throw new BadRequestException('Incorrect delivery code — ask the customer to confirm it');
      }
    }

    const updates: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.deliveryOrder.update({
        where: { id: deliveryOrderId },
        data: { [mapped.deliveryField]: new Date() },
      }),
    ];

    if (mapped.orderStatus) {
      updates.push(
        this.prisma.order.update({
          where: { id: record.orderId },
          data: { status: mapped.orderStatus as any },
        }),
      );
    }

    // Cash-on-delivery: collecting cash IS the payment confirmation.
    // Mark it paid and grant purchase rewards at the same moment the
    // rider marks the order delivered.
    let shouldGrantRewards = false;
    if (action === 'DELIVERED') {
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: record.orderId },
        include: { payment: true },
      });
      if (order.payment && order.payment.method === 'CASH' && order.payment.status !== 'PAID') {
        updates.push(
          this.prisma.payment.update({
            where: { id: order.payment.id },
            data: { status: 'PAID', paidAt: new Date() },
          }),
        );
        shouldGrantRewards = true;
      }
    }

    const result = await this.prisma.$transaction(updates);

    if (shouldGrantRewards) {
      const order = await this.prisma.order.findUniqueOrThrow({ where: { id: record.orderId } });
      await this.prisma.$transaction((tx) =>
        this.orders.grantOrderRewards(tx, order.id, order.customerId, Number(order.totalProteinG), Number(order.totalRs)),
      );
    }

    if (mapped.orderStatus) {
      const order = await this.prisma.order.findUniqueOrThrow({ where: { id: record.orderId } });
      this.gateway.emitOrderStatusUpdate({
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        customerId: order.customerId,
        deliveryPersonId,
      });

      const rider = await this.prisma.deliveryPerson.findUnique({ where: { id: deliveryPersonId }, select: { name: true } });
      this.orders.notifyStatusChange(order.id, mapped.orderStatus, rider?.name).catch(() => undefined);
    }

    return result;
  }

  /**
   * A delivery that was genuinely attempted but couldn't be completed —
   * distinct from an admin/customer cancellation (see the OrderStatus
   * schema comment). Reusable by riders in the field; admins can also
   * call the equivalent from the admin orders view for the same reasons
   * reported to them by phone.
   */
  async reportDeliveryFailure(deliveryPersonId: string, deliveryOrderId: string, reason: string, note?: string) {
    if (!reason?.trim()) throw new BadRequestException('A failure reason is required');

    const record = await this.prisma.deliveryOrder.findUniqueOrThrow({
      where: { id: deliveryOrderId },
      include: { order: true },
    });
    if (record.deliveryPersonId !== deliveryPersonId) {
      throw new ForbiddenException('This order is not assigned to you');
    }
    if (!FAILURE_ELIGIBLE_STATUSES.includes(record.order.status)) {
      throw new BadRequestException(`Cannot report a failure for an order in ${record.order.status} status`);
    }

    const [, updatedOrder] = (await this.prisma.$transaction([
      this.prisma.deliveryOrder.update({
        where: { id: deliveryOrderId },
        data: { failureReason: reason as any, failureNote: note, failedAt: new Date() },
      }),
      this.prisma.order.update({ where: { id: record.orderId }, data: { status: 'FAILED' } }),
    ])) as [any, any];

    this.gateway.emitOrderStatusUpdate({
      orderId: updatedOrder.id,
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      customerId: updatedOrder.customerId,
      deliveryPersonId,
    });

    return updatedOrder;
  }
}
