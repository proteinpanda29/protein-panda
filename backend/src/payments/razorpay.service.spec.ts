import * as crypto from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';
import { RazorpayService } from './razorpay.service';

describe('RazorpayService.verifySignature', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, RAZORPAY_KEY_SECRET: 'test_secret_key' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  const sign = (orderId: string, paymentId: string, secret = 'test_secret_key') =>
    crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

  it('accepts a correctly signed payload', () => {
    const service = new RazorpayService();
    const razorpayOrderId = 'order_ABC123';
    const razorpayPaymentId = 'pay_XYZ789';
    const razorpaySignature = sign(razorpayOrderId, razorpayPaymentId);

    expect(service.verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature })).toBe(true);
  });

  it('rejects a tampered order id (signature no longer matches)', () => {
    const service = new RazorpayService();
    const razorpayPaymentId = 'pay_XYZ789';
    const razorpaySignature = sign('order_ABC123', razorpayPaymentId);

    // Attacker swaps in a different order id but keeps the original signature
    expect(
      service.verifySignature({ razorpayOrderId: 'order_OTHER', razorpayPaymentId, razorpaySignature }),
    ).toBe(false);
  });

  it('rejects a signature produced with the wrong secret', () => {
    const service = new RazorpayService();
    const razorpayOrderId = 'order_ABC123';
    const razorpayPaymentId = 'pay_XYZ789';
    const razorpaySignature = sign(razorpayOrderId, razorpayPaymentId, 'wrong_secret');

    expect(service.verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature })).toBe(false);
  });

  it('rejects an empty/garbage signature', () => {
    const service = new RazorpayService();
    expect(
      service.verifySignature({ razorpayOrderId: 'order_ABC123', razorpayPaymentId: 'pay_XYZ789', razorpaySignature: '' }),
    ).toBe(false);
  });

  it('throws if RAZORPAY_KEY_SECRET is not configured', () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    const service = new RazorpayService();
    expect(() =>
      service.verifySignature({ razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_1', razorpaySignature: 'x' }),
    ).toThrow(InternalServerErrorException);
  });
});

describe('RazorpayService.verifyWebhookSignature', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  const signBody = (body: Buffer, secret = 'test_webhook_secret') =>
    crypto.createHmac('sha256', secret).update(body).digest('hex');

  it('accepts a webhook body signed with the correct webhook secret', () => {
    const service = new RazorpayService();
    const body = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    const signature = signBody(body);

    expect(service.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it('rejects a tampered body — even one byte of difference changes the signature', () => {
    const service = new RazorpayService();
    const originalBody = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    const signature = signBody(originalBody);
    const tamperedBody = Buffer.from(JSON.stringify({ event: 'payment.failed' }));

    expect(service.verifyWebhookSignature(tamperedBody, signature)).toBe(false);
  });

  it('rejects a signature produced with the wrong webhook secret (e.g. someone using the API key secret instead)', () => {
    const service = new RazorpayService();
    const body = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    const signature = signBody(body, 'wrong_secret');

    expect(service.verifyWebhookSignature(body, signature)).toBe(false);
  });

  it('throws if RAZORPAY_WEBHOOK_SECRET is not configured — never silently accepts unverified webhooks', () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const service = new RazorpayService();
    const body = Buffer.from('{}');

    expect(() => service.verifyWebhookSignature(body, 'anything')).toThrow(InternalServerErrorException);
  });
});
