import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PrismaService } from '../common/prisma.service';
import { BusinessDayLockService } from '../common/business-day-lock.service';

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, PrismaService, BusinessDayLockService],
})
export class ExpensesModule {}
