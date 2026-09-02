import { Body, Controller, Headers, Post, Req, UnauthorizedException, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { PaymentsService } from './payments.service';
import { RazorpayService } from './razorpay.service';

class ConfirmPaymentDto {
  @IsString()
  razorpayOrderId: string;

  @IsString()
  razorpayPaymentId: string;

  @IsString()
  razorpaySignature: string;
}

@Controller('payments')
export class PaymentsController {
  constructor(
    private payments: PaymentsService,
    private razorpay: RazorpayService,
  ) {}

  @Post('orders/:orderId/razorpay')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // payment endpoints: very strict limit
  createRazorpayOrder(@Req() req: any, @Param('orderId') orderId: string) {
    return this.payments.createRazorpayOrder(req.user.customerId, orderId);
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Req() req: any, @Body() dto: ConfirmPaymentDto) {
    return this.payments.confirmPayment(req.user.customerId, dto);
  }

  /**
   * Razorpay's server-to-server webhook — deliberately has NO auth
   * guard (Razorpay isn't a logged-in user and can't send our JWT).
   * Trust comes entirely from the HMAC signature below, verified
   * against the raw request bytes. This is the reliability backstop for
   * `verify` above: it fires independently of the customer's browser, so
   * a closed tab or dropped connection after a successful charge still
   * gets reconciled instead of leaving the order stuck PENDING forever.
   */
  @Post('webhook')
  async webhook(@Req() req: any, @Headers('x-razorpay-signature') signature: string) {
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody || !signature || !this.razorpay.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const body = JSON.parse(rawBody.toString('utf8'));
    if (body.event === 'payment.captured') {
      const entity = body.payload?.payment?.entity;
      if (entity?.order_id && entity?.id) {
        await this.payments.confirmPaymentFromWebhook(entity.order_id, entity.id);
      }
    }
    // Payment Links (used for POS/counter-sale UPI — see
    // PaymentsService.createPaymentLinkForOrder) fire a dedicated event
    // rather than reusing payment.captured with a matching order_id, so
    // this needs its own branch. The Payment Link's own id was stashed
    // as Payment.transactionRef at creation time — confirmPaymentFromWebhook
    // already matches on that field, so this reuses the exact same
    // confirmation path as the online-checkout flow above, not a
    // separate one.
    if (body.event === 'payment_link.paid') {
      const linkId = body.payload?.payment_link?.entity?.id;
      const paymentId = body.payload?.payment?.entity?.id;
      if (linkId && paymentId) {
        await this.payments.confirmPaymentFromWebhook(linkId, paymentId);
      }
    }
    // Razorpay only cares about a 2xx response; other event types are
    // acknowledged and ignored (e.g. payment.failed doesn't need action
    // here — the order simply stays unpaid, same as before this event
    // existed).
    return { received: true };
  }
}
