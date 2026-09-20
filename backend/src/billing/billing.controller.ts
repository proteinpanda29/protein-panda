import { Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
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

/**
 * Deliberately its own, unguarded controller — WhatsApp has no way to
 * carry a login session, so this is the one invoice-viewing route that
 * can never require JwtAuthGuard. Safety comes entirely from the
 * unguessable HMAC token instead (see InvoiceService.generateInvoiceAccessToken):
 * without the exact right token for this exact order id, the request
 * is rejected before any order data is ever touched.
 */
@Controller('orders/:id/invoice-public')
export class PublicInvoiceController {
  constructor(
    private invoices: InvoiceService,
    private pdf: PdfService,
  ) {}

  @Get()
  async getPublicInvoicePdf(@Param('id') id: string, @Query('token') token: string, @Res() res: FastifyReply) {
    if (!token || !this.invoices.verifyInvoiceAccessToken(id, token)) {
      res.status(403).send({ message: 'Invalid or missing invoice access token' });
      return;
    }
    const order = await this.invoices.getInvoiceDataUnchecked(id);
    const buffer = await this.pdf.generateOrderInvoicePdf(id);
    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="invoice-${order.orderNumber}.pdf"`)
      .send(buffer);
  }
}
