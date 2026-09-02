import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { RazorpayService } from './razorpay.service';
import { PrismaService } from '../common/prisma.service';
import { OrdersModule } from '../orders/orders.module';
import { RealtimeModule } from '../common/realtime.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [OrdersModule, RealtimeModule, BillingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, RazorpayService, PrismaService],
  // Without this, PosModule (which needs PaymentsService for the UPI
  // Payment Link flow) cannot actually inject it — a provider is
  // private to its own module by default. This is exactly the kind of
  // bug Jest can never catch (it constructs services directly with
  // `new PosService(...)`, bypassing Nest's real DI container
  // entirely) — only surfaced now via an actual boot test.
  exports: [PaymentsService],
})
export class PaymentsModule {}
