import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { BillingController } from './billing.controller';
import { PrismaService } from '../common/prisma.service';
import { EmailService } from '../notifications/email.service';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [PdfModule],
  controllers: [BillingController],
  providers: [InvoiceService, PrismaService, EmailService],
  exports: [InvoiceService],
})
export class BillingModule {}
