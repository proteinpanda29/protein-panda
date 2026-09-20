import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { EmailService } from '../notifications/email.service';

@Injectable()
export class InvoiceService {
  private logger = new Logger('InvoiceService');

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  /**
   * A stateless, unguessable token for one specific order — what lets
   * a WhatsApp link open an invoice PDF without the recipient logging
   * in at all (WhatsApp has no way to carry an auth session). HMAC
   * against JWT_SECRET rather than a random per-order value stored in
   * the database — nothing new to persist, and it's exactly as hard
   * to forge as a JWT already is, since it uses the same secret.
   */
  generateInvoiceAccessToken(orderId: string): string {
    return createHmac('sha256', process.env.JWT_SECRET ?? 'dev-secret')
      .update(orderId)
      .digest('hex')
      .slice(0, 32);
  }

  verifyInvoiceAccessToken(orderId: string, token: string): boolean {
    return this.generateInvoiceAccessToken(orderId) === token;
  }

  private async loadOrderForInvoice(orderId: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { include: { product: true, addons: { include: { addon: true } } } },
        payment: true,
        customer: { include: { user: { select: { email: true, phone: true } } } },
      },
    });
  }

  generateInvoiceHtml(
    order: Awaited<ReturnType<InvoiceService['loadOrderForInvoice']>>,
    brand: { businessName: string; tagline: string | null; primaryColorHex: string } = {
      businessName: 'Protein Panda',
      tagline: 'Eat Clean. Stay Strong. Be Better. 🐼',
      primaryColorHex: '#6F8615',
    },
  ): string {
    const rows = order.items
      .map((item: any) => {
        const addonNames = item.addons.map((a: any) => a.addon.name).join(', ');
        return `
          <tr>
            <td style="padding:6px 0;">${item.product.name}${addonNames ? ` <span style="color:#888;font-size:12px;">(${addonNames})</span>` : ''}</td>
            <td style="padding:6px 0;text-align:center;">${item.quantity}</td>
            <td style="padding:6px 0;text-align:right;">₹${Number(item.lineTotalRs).toFixed(2)}</td>
          </tr>`;
      })
      .join('');

    return `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#080808;">${brand.businessName}</h2>
        <p style="color:${brand.primaryColorHex};font-weight:bold;">Invoice #${order.orderNumber}</p>
        <p style="color:#555;font-size:13px;">${new Date(order.createdAt).toLocaleString()}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <thead>
            <tr style="border-bottom:2px solid #080808;">
              <th style="text-align:left;padding:6px 0;">Item</th>
              <th style="text-align:center;padding:6px 0;">Qty</th>
              <th style="text-align:right;padding:6px 0;">Amount</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="border-top:1px solid #ddd;margin-top:12px;padding-top:12px;">
          <p style="display:flex;justify-content:space-between;margin:2px 0;">Subtotal <span>₹${Number(order.subtotalRs).toFixed(2)}</span></p>
          ${Number(order.discountRs) > 0 ? `<p style="display:flex;justify-content:space-between;margin:2px 0;color:${brand.primaryColorHex};">Discount <span>-₹${Number(order.discountRs).toFixed(2)}</span></p>` : ''}
          <p style="display:flex;justify-content:space-between;margin:6px 0;font-weight:bold;font-size:16px;">Total <span>₹${Number(order.totalRs).toFixed(2)}</span></p>
        </div>
        <p style="color:#555;font-size:13px;margin-top:12px;">
          Payment: ${order.payment?.method ?? 'N/A'} · ${order.payment?.status ?? ''}
        </p>
        <p style="color:#555;font-size:13px;">Protein this order: ${Number(order.totalProteinG).toFixed(0)}g · ${order.totalCalories} kcal</p>
        ${brand.tagline ? `<p style="margin-top:24px;color:#080808;font-weight:bold;">${brand.tagline}</p>` : ''}
      </div>`;
  }

  /**
   * Fire-and-forget from the caller's perspective — never throws, so a
   * missed e-bill never blocks order creation or payment confirmation.
   */
  async sendInvoiceEmail(orderId: string): Promise<void> {
    try {
      const order = await this.loadOrderForInvoice(orderId);
      const email = order.customer.user.email;
      if (!email) {
        this.logger.log(`No email on file for order ${order.orderNumber} — skipping e-bill email (customer signed up with phone only)`);
        return;
      }

      const shopSettings = await this.prisma.shopSettings.findUnique({ where: { id: 'default' } });
      const brand = {
        businessName: shopSettings?.businessName ?? 'Protein Panda',
        tagline: shopSettings?.tagline ?? null,
        primaryColorHex: shopSettings?.primaryColorHex ?? '#6F8615',
      };

      const html = this.generateInvoiceHtml(order, brand);
      await this.email.send({
        to: email,
        subject: `Your ${brand.businessName} receipt — #${order.orderNumber}`,
        html,
        fromName: brand.businessName,
      });
    } catch (err) {
      this.logger.error(`Failed to send invoice for order ${orderId}: ${(err as Error).message}`);
    }
  }

  /** Used by the "Resend" button and the frontend "View Bill" page. */
  async getInvoiceData(customerId: string, orderId: string) {
    const order = await this.loadOrderForInvoice(orderId);
    if (order.customerId !== customerId) {
      throw new Error('This order does not belong to you');
    }
    return order;
  }

  /** Ownership-unchecked variant for the token-verified public WhatsApp invoice route — the token itself is what proves the right to view this specific order. */
  async getInvoiceDataUnchecked(orderId: string) {
    return this.loadOrderForInvoice(orderId);
  }
}
