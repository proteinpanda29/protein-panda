import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PrismaService } from '../common/prisma.service';
import { PointsService } from '../points/points.service';
import { StreaksService } from '../streaks/streaks.service';
import { AttendanceService } from '../streaks/attendance.service';
import { RealtimeModule } from '../common/realtime.module';
import { RedisService } from '../common/redis.service';
import { AchievementsModule } from '../achievements/achievements.module';
import { ShopModule } from '../shop/shop.module';
import { BillingModule } from '../billing/billing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationCenterModule } from '../notification-center/notification-center.module';
import { WalletService } from '../customers/wallet.service';

@Module({
  imports: [RealtimeModule, AchievementsModule, ShopModule, BillingModule, InventoryModule, NotificationCenterModule],
  controllers: [OrdersController],
  providers: [OrdersService, PrismaService, PointsService, StreaksService, AttendanceService, RedisService, WalletService],
  exports: [OrdersService],
})
export class OrdersModule {}
