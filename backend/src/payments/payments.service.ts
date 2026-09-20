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
      referenceId: order.id,
      description: `Order ${order.orderNumber}`,
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

  /**
   * A tip paid by real money (UPI/card/etc via Razorpay), as an
   * alternative to the existing wallet-balance tip — a customer with
   * no wallet balance (or who'd simply rather pay directly) shouldn't
   * be limited to wallet-only. Deliberately not tied to the Payment
   * model (which is 1:1 with a real Order) since a tip isn't an order
   * payment; the delivery order id and amount are instead encoded
   * directly into the Payment Link's own reference_id, which the
   * webhook reads back to know exactly which delivery to credit once
   * Razorpay confirms it — see confirmTipPayment below.
   */
  async createTipPaymentLink(customerId: string, orderId: string, amountRs: number) {
    if (amountRs <= 0) throw new BadRequestException('Tip amount must be positive');

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { deliveryOrder: true } });
    if (order.customerId !== customerId) throw new ForbiddenException('This order does not belong to you');
    if (!order.deliveryOrder) throw new BadRequestException('This order has no delivery to tip');
    if (order.status !== 'DELIVERED') throw new BadRequestException('You can only tip after your order has been delivered');
    if (Number(order.deliveryOrder.tipAmountRs) > 0) throw new BadRequestException('You have already tipped this delivery');

    const paymentLink = await this.razorpay.createPaymentLink({
      amountRs,
      referenceId: `tip:${order.deliveryOrder.id}:${amountRs}`,
      description: `Tip for order ${order.orderNumber}`,
    });

    return { paymentLinkId: paymentLink.id, shortUrl: paymentLink.short_url };
  }

  /**
   * Called from the webhook once Razorpay confirms a tip's Payment
   * Link was actually paid — parses the delivery order id and amount
   * back out of the reference_id createTipPaymentLink encoded, and
   * applies it the exact same way the wallet-based tip path already
   * does. Idempotent for the same reason as settlePayment above: a
   * duplicate webhook delivery must never double-apply a tip.
   */
  async confirmTipPayment(deliveryOrderId: string, amountRs: number) {
    const deliveryOrder = await this.prisma.deliveryOrder.findUnique({ where: { id: deliveryOrderId } });
    if (!deliveryOrder) return; // nothing sensible to do with a tip for a delivery order that no longer exists
    if (Number(deliveryOrder.tipAmountRs) > 0) return; // already applied — duplicate webhook delivery

    await this.prisma.deliveryOrder.update({ where: { id: deliveryOrderId }, data: { tipAmountRs: amountRs } });
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

    // WhatsApp payment confirmation — the one case this covers that
    // the order-creation-time WhatsApp messages in orders.service.ts
    // never do: any order that starts PENDING and gets paid later via
    // a Razorpay Payment Link (POS counter UPI, and — the reason this
    // was actually missing — every WhatsApp-bot checkout, which always
    // pays this way). Without this, a customer who orders and pays
    // entirely through WhatsApp chat never gets any confirmation at
    // all once they actually pay, since the order was never "paid
    // immediately" at creation time.
    //
    // A business-initiated message outside the customer's own active
    // chat window needs a pre-approved template, same requirement as
    // the existing order-confirmed/invoice-shared sends — this is
    // WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED specifically so it can be
    // worded for "you just paid," distinct from "your order was
    // placed."
    if (process.env.WHATSAPP_AUTH_KEY && process.env.WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED) {
      this.prisma.customer
        .findUnique({ where: { id: payment.order.customerId }, include: { user: true } })
        .then((customer: { user: { phone: string | null } } | null) => {
          const phone = customer?.user?.phone;
          if (!phone) return;
          this.notificationQueue
            .queueWhatsAppNotification(phone, process.env.WHATSAPP_TEMPLATE_PAYMENT_CONFIRMED!, [
              payment.order.orderNumber,
              `Rs ${payment.order.totalRs}`,
            ])
            .catch(() => undefined);
        })
        .catch(() => undefined);
    }

    return { alreadyConfirmed: false, orderId: payment.order.id };
  }
}
