import { BadRequestException, Injectable } from '@nestjs/common';
import { FulfillmentType, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class PosService {
  constructor(
    private prisma: PrismaService,
    private orders: OrdersService,
    private payments: PaymentsService,
  ) {}

  /** Search by name, phone, or email so the counter can find a returning customer fast. */
  async searchCustomers(query: string) {
    if (!query || query.trim().length < 2) return [];

    return this.prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { user: { phone: { contains: query } } },
          { user: { email: { contains: query, mode: 'insensitive' } } },
        ],
      },
      take: 10,
      include: { user: { select: { phone: true, email: true } } },
    });
  }

  /**
   * Staff-initiated signup at the counter — no OTP, since the person is
   * physically present and staff can verify identity in person. Mirrors
   * AuthService's self-signup shape (always CUSTOMER role) but skips the
   * verification step entirely.
   */
  async createWalkInCustomer(name: string, identifier: string) {
    if (!identifier?.trim()) throw new BadRequestException('A phone number or email is required');
    const isEmailIdentifier = EMAIL_RE.test(identifier);

    const existing = isEmailIdentifier
      ? await this.prisma.user.findUnique({ where: { email: identifier } })
      : await this.prisma.user.findUnique({ where: { phone: identifier } });
    if (existing) throw new BadRequestException('A customer with this phone/email already exists — search for them instead');

    const user = await this.prisma.user.create({
      data: {
        role: 'CUSTOMER',
        phone: isEmailIdentifier ? null : identifier,
        email: isEmailIdentifier ? identifier : null,
        customer: { create: { name: name?.trim() || 'Walk-in Customer' } },
      },
      include: { customer: true },
    });

    return user.customer;
  }

  /** Discount-type rewards this customer has already redeemed (spent points on) but not yet used on an order — what POS can offer to apply. */
  async listAvailableRedemptions(customerId: string) {
    return this.prisma.rewardRedemption.findMany({
      where: { customerId, usedAt: null, reward: { type: 'DISCOUNT' } },
      include: { reward: true },
      orderBy: { redeemedAt: 'desc' },
    });
  }

  /**
   * The actual counter sale. Payment is always treated as collected in
   * person (markPaidImmediately) regardless of which method the customer
   * used to pay at the register — cash, UPI, or card all settle
   * instantly at a physical counter, unlike an online checkout that can
   * be abandoned mid-payment.
   */
  async createSale(
    adminUserId: string,
    input: {
      customerId: string;
      items: { productId: string; quantity: number; addonIds?: string[] }[];
      paymentMethod: PaymentMethod;
      fulfillmentType?: FulfillmentType;
      couponCode?: string;
      redemptionId?: string;
      manualDiscountRs?: number;
      idempotencyKey?: string;
    },
  ) {
    // UPI genuinely needs to be collected, not just declared — CASH and
    // CARD are confirmed in person by staff (a card machine has its own
    // separate physical confirmation), but there is no equivalent
    // physical confirmation step for UPI, so it used to just get marked
    // paid immediately with no actual payment ever collected. Found via
    // a real report: "shows paid and downloads the receipt" without
    // ever redirecting to a payment page — because there was no payment
    // step at all. Now: UPI creates the order PENDING, same as an
    // online order, and a Razorpay Payment Link is generated for the
    // customer to scan and pay on their own phone — the order only
    // becomes PAID once Razorpay's webhook actually confirms it.
    const isUpi = input.paymentMethod === 'UPI';

    const order = await this.orders.create({
      customerId: input.customerId,
      channel: 'IN_STORE',
      fulfillmentType: input.fulfillmentType ?? 'PICKUP',
      paymentMethod: input.paymentMethod,
      items: input.items,
      couponCode: input.couponCode,
      redemptionId: input.redemptionId,
      manualDiscountRs: input.manualDiscountRs,
      markPaidImmediately: !isUpi,
      processedByUserId: adminUserId,
      idempotencyKey: input.idempotencyKey,
    });

    if (!isUpi) return order;

    const paymentLink = await this.payments.createPaymentLinkForOrder(order.id);
    return { ...order, paymentLink };
  }
}
