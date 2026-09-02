import { Module } from '@nestjs/common';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';
import { PrismaService } from '../common/prisma.service';
import { BusinessDayLockService } from '../common/business-day-lock.service';

@Module({
  controllers: [CashController],
  providers: [CashService, PrismaService, BusinessDayLockService],
})
export class CashModule {}
