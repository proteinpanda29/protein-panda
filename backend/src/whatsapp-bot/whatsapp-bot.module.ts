import { Module } from '@nestjs/common';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { WhatsAppWebhookController } from './whatsapp-bot.controller';
import { PrismaService } from '../common/prisma.service';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [ProductsModule, OrdersModule, PaymentsModule, QueueModule],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppBotService, PrismaService],
})
export class WhatsAppBotModule {}
