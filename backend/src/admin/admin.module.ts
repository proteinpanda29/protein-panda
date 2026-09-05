import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { PrismaService } from '../common/prisma.service';
import { OrdersModule } from '../orders/orders.module';
import { RealtimeModule } from '../common/realtime.module';
import { PdfModule } from '../pdf/pdf.module';
import { UploadsService } from './uploads.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BusinessDayLockService } from '../common/business-day-lock.service';
import { SegmentsService } from '../customers/segments.service';
import { ExpensesService } from '../expenses/expenses.service';
import { SuppliersService } from '../suppliers/suppliers.service';

@Module({
  imports: [OrdersModule, RealtimeModule, PdfModule, AuditLogModule],
  controllers: [AdminController],
  providers: [AdminService, PrismaService, UploadsService, BusinessDayLockService, SegmentsService, ExpensesService, SuppliersService],
  exports: [UploadsService],
})
export class AdminModule {}
