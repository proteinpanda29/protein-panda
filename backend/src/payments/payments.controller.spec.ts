import { UnauthorizedException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';

function makeHarness() {
  const payments = { confirmPaymentFromWebhook: jest.fn().mockResolvedValue(undefined) } as any;
  const razorpay = { verifyWebhookSignature: jest.fn().mockReturnValue(true) } as any;
  const controller = new PaymentsController(payments, razorpay);
  return { controller, payments, razorpay };
}

function makeReq(body: object) {
  return { rawBody: Buffer.from(JSON.stringify(body)) };
}

describe('PaymentsController.webhook', () => {
  it('rejects a request with an invalid signature before looking at the body at all', async () => {
    const { controller, razorpay } = makeHarness();
    razorpay.verifyWebhookSignature.mockReturnValue(false);

    await expect(controller.webhook(makeReq({ event: 'payment.captured' }), 'bad-signature')).rejects.toThrow(UnauthorizedException);
  });

  it('confirms via order_id for a payment.captured event (the online-checkout path)', async () => {
    const { controller, payments } = makeHarness();
    const body = { event: 'payment.captured', payload: { payment: { entity: { order_id: 'order_rzp_1', id: 'pay_1' } } } };

    await controller.webhook(makeReq(body), 'sig');

    expect(payments.confirmPaymentFromWebhook).toHaveBeenCalledWith('order_rzp_1', 'pay_1');
  });

  it('confirms via the Payment Link id for a payment_link.paid event (the POS UPI path)', async () => {
    const { controller, payments } = makeHarness();
    const body = {
      event: 'payment_link.paid',
      payload: { payment_link: { entity: { id: 'plink_1' } }, payment: { entity: { id: 'pay_1' } } },
    };

    await controller.webhook(makeReq(body), 'sig');

    expect(payments.confirmPaymentFromWebhook).toHaveBeenCalledWith('plink_1', 'pay_1');
  });

  it('ignores an unrelated event type without erroring', async () => {
    const { controller, payments } = makeHarness();

    const result = await controller.webhook(makeReq({ event: 'payment.failed' }), 'sig');

    expect(payments.confirmPaymentFromWebhook).not.toHaveBeenCalled();
    expect(result).toEqual({ received: true });
  });

  it('does not call confirmPaymentFromWebhook if the payment_link.paid payload is missing the expected ids', async () => {
    const { controller, payments } = makeHarness();
    const body = { event: 'payment_link.paid', payload: {} };

    await controller.webhook(makeReq(body), 'sig');

    expect(payments.confirmPaymentFromWebhook).not.toHaveBeenCalled();
  });
});
