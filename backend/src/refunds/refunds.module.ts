import { Module } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { RefundsController } from './refunds.controller';
import { PrismaService } from '../common/prisma.service';
import { PointsService } from '../points/points.service';
import { InventoryModule } from '../inventory/inventory.module';
import { RazorpayService } from '../payments/razorpay.service';
import { RedisService } from '../common/redis.service';
import { WalletService } from '../customers/wallet.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BusinessDayLockService } from '../common/business-day-lock.service';

@Module({
  imports: [InventoryModule, AuditLogModule],
  controllers: [RefundsController],
  providers: [RefundsService, PrismaService, PointsService, RazorpayService, RedisService, WalletService, BusinessDayLockService],
})
export class RefundsModule {}
