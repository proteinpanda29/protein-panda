import { Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { InvoiceService } from './invoice.service';
import { PdfService } from '../pdf/pdf.service';

@Controller('orders/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class BillingController {
  constructor(
    private invoices: InvoiceService,
    private pdf: PdfService,
  ) {}

  @Get('invoice')
  getInvoice(@Req() req: any, @Param('id') id: string) {
    return this.invoices.getInvoiceData(req.user.customerId, id);
  }

  @Post('invoice/resend')
  async resend(@Req() req: any, @Param('id') id: string) {
    // Ownership check happens via getInvoiceData before we bother sending.
    await this.invoices.getInvoiceData(req.user.customerId, id);
    await this.invoices.sendInvoiceEmail(id);
    return { sent: true };
  }

  @Get('invoice.pdf')
  async getInvoicePdf(@Req() req: any, @Param('id') id: string, @Res() res: FastifyReply) {
    // Ownership check first — the same order data getInvoiceData already
    // validates, so a customer can never download another customer's PDF
    // by guessing an order id.
    const order = await this.invoices.getInvoiceData(req.user.customerId, id);
    const buffer = await this.pdf.generateOrderInvoicePdf(id);
    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="invoice-${order.orderNumber}.pdf"`)
      .send(buffer);
  }
}
