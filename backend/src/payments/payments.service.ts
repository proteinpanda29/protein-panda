import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { RazorpayService } from './razorpay.service';
import { OrdersService } from '../orders/orders.service';
import { OrdersGateway } from '../common/orders.gateway';
import { NotificationQueueService } from '../queue/notification-queue.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private razorpay: RazorpayService,
    private orders: OrdersService,
    private gateway: OrdersGateway,
    private notificationQueue: NotificationQueueService,
  ) {}

  async createRazorpayOrder(customerId: string, orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { payment: true },
    });

    if (order.customerId !== customerId) {
      throw new ForbiddenException('This order does not belong to you');
    }
    if (!order.payment) throw new NotFoundException('No payment record for this order');
    if (order.payment.status === 'PAID') {
      throw new BadRequestException('This order has already been paid');
    }

    const razorpayOrder = await this.razorpay.createOrder({
      amountRs: Number(order.payment.amountRs),
      receipt: order.orderNumber,
    });

    // Stash the gateway order id so the verify step can find this Payment
    // record again by it. It gets overwritten with the actual payment id
    // once the payment is confirmed.
    await this.prisma.payment.update({
      where: { id: order.payment.id },
      data: { transactionRef: razorpayOrder.id },
    });

    return {
      razorpayOrderId: razorpayOrder.id,
      amountPaise: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: this.razorpay.keyId,
      orderNumber: order.orderNumber,
    };
  }

  /**
   * The POS/counter-sale equivalent of createRazorpayOrder above — same
   * shape (validate the payment exists and isn't already paid, stash a
   * gateway identifier on Payment.transactionRef so the webhook can find
   * it again), but generates a Payment Link instead of a Checkout.js
   * order, since the paying customer's own phone (not the counter's
   * device) is what completes the payment here. No customerId ownership
   * check — this is admin/POS-initiated, not a customer's own request.
   */
  async createPaymentLinkForOrder(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { payment: true },
    });

    if (!order.payment) throw new NotFoundException('No payment record for this order');
    if (order.payment.status === 'PAID') {
      throw new BadRequestException('This order has already been paid');
    }

    const paymentLink = await this.razorpay.createPaymentLink({
      amountRs: Number(order.payment.amountRs),
      orderId: order.id,
      orderNumber: order.orderNumber,
    });

    await this.prisma.payment.update({
      where: { id: order.payment.id },
      data: { transactionRef: paymentLink.id },
    });

    return {
      paymentLinkId: paymentLink.id,
      shortUrl: paymentLink.short_url,
      orderNumber: order.orderNumber,
    };
  }

  async confirmPayment(
    customerId: string,
    params: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  ) {
    const valid = this.razorpay.verifySignature(params);
    if (!valid) throw new BadRequestException('Payment signature verification failed');

    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef: params.razorpayOrderId },
      include: { order: true },
    });
    if (!payment) throw new NotFoundException('No matching payment found');
    if (payment.order.customerId !== customerId) {
      throw new ForbiddenException('This payment does not belong to you');
    }

    return this.settlePayment(payment, params.razorpayPaymentId);
  }

  /**
   * Server-to-server confirmation from Razorpay's webhook — the
   * reliability backstop for the customer-callback path above. If the
   * customer's browser closes or the network drops right after Razorpay
   * actually charges them, the checkout callback never fires and the
   * order would be stuck PENDING forever with no automatic recovery.
   * The webhook fires independently of the browser, so this is what
   * actually guarantees a captured payment always gets reconciled.
   * Trusted via the webhook's own HMAC signature (verified by the
   * caller) rather than a customerId ownership check — this is a
   * server-to-server call, there is no "requesting user" to check
   * against.
   */
  async confirmPaymentFromWebhook(razorpayOrderId: string, razorpayPaymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef: razorpayOrderId },
      include: { order: true },
    });
    if (!payment) throw new NotFoundException('No matching payment found');

    return this.settlePayment(payment, razorpayPaymentId);
  }

  private async settlePayment(payment: any, razorpayPaymentId: string) {
    if (payment.status === 'PAID') {
      return { alreadyConfirmed: true, orderId: payment.order.id };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'PAID', paidAt: new Date(), transactionRef: razorpayPaymentId },
      });

      // Only now — with a verified, confirmed payment — grant the
      // purchase's points/streak/goal-progress rewards.
      await this.orders.grantOrderRewards(
        tx,
        payment.order.id,
        payment.order.customerId,
        Number(payment.order.totalProteinG),
        Number(payment.order.totalRs),
      );
    });

    this.gateway.emitOrderStatusUpdate({
      orderId: payment.order.id,
      orderNumber: payment.order.orderNumber,
      status: payment.order.status,
      customerId: payment.order.customerId,
    });

    // Only now that payment is verified does the e-bill go out — matches
    // the same "confirmed, not just placed" rule as rewards above.
    this.notificationQueue.queueInvoiceEmail(payment.order.id).catch(() => undefined);

    return { alreadyConfirmed: false, orderId: payment.order.id };
  }
}
