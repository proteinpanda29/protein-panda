import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';
import { PrismaService } from '../common/prisma.service';
import { RealtimeModule } from '../common/realtime.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [RealtimeModule, OrdersModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, PrismaService],
})
export class DeliveryModule {}
