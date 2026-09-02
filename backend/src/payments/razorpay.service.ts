import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';

@Injectable()
export class RazorpayService {
  private client: Razorpay | null = null;

  private getClient(): Razorpay {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new InternalServerErrorException('Payment gateway is not configured (RAZORPAY_KEY_ID/SECRET missing)');
    }
    if (!this.client) {
      this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
    return this.client;
  }

  get keyId() {
    return process.env.RAZORPAY_KEY_ID ?? '';
  }

  /** amountRs is in rupees; Razorpay expects the smallest currency unit (paise). */
  async createOrder(params: { amountRs: number; receipt: string }) {
    const client = this.getClient();
    return client.orders.create({
      amount: Math.round(params.amountRs * 100),
      currency: 'INR',
      receipt: params.receipt,
    });
  }

  /**
   * A Payment Link — Razorpay hosts the entire payment page itself
   * (UPI/card/wallet, customer's choice), unlike createOrder() above
   * which needs Checkout.js running in the paying customer's own
   * browser session. Built specifically for POS: the customer at the
   * counter scans a QR code (generated client-side from the returned
   * short_url) with their own phone — there's no browser session on
   * the counter's device to run Checkout.js in.
   *
   * referenceId is set to our own order id — the webhook handler
   * matches back to the right order via the Payment Link id stored as
   * Payment.transactionRef at creation time (see
   * PaymentsService.createPaymentLinkForOrder), not via referenceId
   * directly, but it's included too as a second, human-readable trail
   * for manual reconciliation in the Razorpay dashboard if ever needed.
   *
   * Deliberately NOT using the QR Codes API (a different Razorpay
   * product) — that one requires requesting activation from Razorpay
   * support first; Payment Links work immediately with a standard
   * account.
   */
  async createPaymentLink(params: { amountRs: number; orderId: string; orderNumber: string }) {
    const client = this.getClient();
    return (client as any).paymentLink.create({
      amount: Math.round(params.amountRs * 100),
      currency: 'INR',
      reference_id: params.orderId,
      description: `Order ${params.orderNumber}`,
      notify: { sms: false, email: false }, // the QR code is the delivery mechanism, not Razorpay's own notify
    });
  }

  /**
   * Issues a refund for a previously captured payment. razorpayPaymentId
   * is Razorpay's payment id (stored as Payment.transactionRef once a
   * payment is confirmed — see PaymentsService.settlePayment). Partial
   * refunds are supported natively by Razorpay's API; calling this
   * multiple times for the same payment with different amounts is how a
   * multi-step partial refund works.
   */
  async refundPayment(razorpayPaymentId: string, amountRs: number) {
    const client = this.getClient();
    return client.payments.refund(razorpayPaymentId, {
      amount: Math.round(amountRs * 100),
    });
  }

  /**
   * Verifies the checkout callback signature per Razorpay's documented
   * scheme: HMAC-SHA256 of "razorpay_order_id|razorpay_payment_id" using
   * the account's key secret. This is the only trustworthy confirmation
   * that a payment succeeded — the frontend callback alone is not.
   */
  verifySignature(params: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) throw new InternalServerErrorException('Payment gateway is not configured');

    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`)
      .digest('hex');

    return expected === params.razorpaySignature;
  }

  /**
   * Verifies a Razorpay webhook payload per their documented scheme:
   * HMAC-SHA256 of the raw request body using a separate webhook secret
   * (configured in the Razorpay Dashboard, not the same as the API key
   * secret). This is what makes server-to-server webhook confirmation
   * trustworthy even when nothing ever came from the customer's browser.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) throw new InternalServerErrorException('Webhook secret not configured (RAZORPAY_WEBHOOK_SECRET)');

    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return expected === signature;
  }
}
