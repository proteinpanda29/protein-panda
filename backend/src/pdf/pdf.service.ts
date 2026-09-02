import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { PrismaService } from '../common/prisma.service';

// 80mm thermal-receipt width in PDF points (1mm ≈ 2.8346pt) — genuinely
// usable both as a downloadable PDF and, later, sent straight to a
// receipt printer without redesigning anything. Height is generous and
// pdfkit auto-paginates if content overflows a page, so a long order
// with many line items still renders correctly across multiple pages.
const RECEIPT_WIDTH = 227;
const RECEIPT_HEIGHT = 700;
const MARGIN = 14;

interface Brand {
  businessName: string;
  address: string | null;
  contactPhone: string | null;
  fssaiNumber: string | null;
}

@Injectable()
export class PdfService {
  constructor(private prisma: PrismaService) {}

  private async getBrand(): Promise<Brand> {
    const settings = await this.prisma.shopSettings.findUnique({ where: { id: 'default' } });
    return {
      businessName: settings?.businessName ?? 'Protein Panda',
      address: settings?.address ?? null,
      contactPhone: settings?.contactPhone ?? null,
      fssaiNumber: settings?.fssaiNumber ?? null,
    };
  }

  private streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }

  private newReceiptDoc(brand: Brand, title: string): PDFKit.PDFDocument {
    // compress: false — these are small receipts (a few KB either way),
    // and leaving text streams uncompressed makes generated PDFs easy to
    // inspect/debug directly, which matters more here than the marginal
    // file-size savings compression would give.
    const doc = new PDFDocument({ size: [RECEIPT_WIDTH, RECEIPT_HEIGHT], margin: MARGIN, autoFirstPage: true, compress: false });

    doc.font('Helvetica-Bold').fontSize(13).text(brand.businessName, { align: 'center' });
    if (brand.address) doc.font('Helvetica').fontSize(7).text(brand.address, { align: 'center' });
    const contactLine = [brand.contactPhone, brand.fssaiNumber ? `FSSAI: ${brand.fssaiNumber}` : null]
      .filter(Boolean)
      .join('  ·  ');
    if (contactLine) doc.fontSize(7).text(contactLine, { align: 'center' });
    doc.moveDown(0.5);
    this.divider(doc);
    doc.font('Helvetica-Bold').fontSize(10).text(title, { align: 'center' });
    this.divider(doc);
    return doc;
  }

  private divider(doc: PDFKit.PDFDocument) {
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(RECEIPT_WIDTH - MARGIN, doc.y)
      .dash(1, { space: 1 })
      .stroke()
      .undash();
    doc.moveDown(0.4);
  }

  private row(doc: PDFKit.PDFDocument, left: string, right: string, opts: { bold?: boolean } = {}) {
    const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(font).fontSize(8);
    const y = doc.y;
    const usableWidth = RECEIPT_WIDTH - MARGIN * 2;
    const rightWidth = doc.widthOfString(right) + 4;
    doc.text(left, MARGIN, y, { width: usableWidth - rightWidth });
    doc.text(right, MARGIN, y, { width: usableWidth, align: 'right' });
    doc.moveDown(0.2);
  }

  /**
   * A real POS-style receipt PDF for a completed order — itemized lines,
   * subtotal/discount/total, payment method and status. Ownership is
   * checked by the controller before this is called, not here (this
   * service has no concept of "who's asking," same separation the rest
   * of the codebase already uses).
   */
  async generateOrderInvoicePdf(orderId: string): Promise<Buffer> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { include: { product: true, addons: { include: { addon: true } } } },
        payment: true,
        customer: true,
      },
    });
    const brand = await this.getBrand();

    const doc = this.newReceiptDoc(brand, 'INVOICE');
    this.row(doc, 'Order #', order.orderNumber);
    this.row(doc, 'Date', new Date(order.createdAt).toLocaleString());
    this.row(doc, 'Customer', order.customer.name);
    doc.moveDown(0.3);
    this.divider(doc);

    for (const item of order.items) {
      const addonNames = item.addons.map((a: { addon: { name: string } }) => a.addon.name).join(', ');
      this.row(doc, `${item.quantity}x ${item.product.name}`, `₹${Number(item.lineTotalRs).toFixed(2)}`);
      if (addonNames) {
        doc.font('Helvetica').fontSize(6.5).fillColor('#555').text(`  ${addonNames}`, { width: RECEIPT_WIDTH - MARGIN * 2 });
        doc.fillColor('#000');
      }
    }

    this.divider(doc);
    this.row(doc, 'Subtotal', `₹${Number(order.subtotalRs).toFixed(2)}`);
    if (Number(order.discountRs) > 0) {
      this.row(doc, 'Discount', `-₹${Number(order.discountRs).toFixed(2)}`);
    }
    this.row(doc, 'TOTAL', `₹${Number(order.totalRs).toFixed(2)}`, { bold: true });
    doc.moveDown(0.3);
    this.divider(doc);

    if (order.payment) {
      this.row(doc, 'Payment', order.payment.method);
      this.row(doc, 'Status', order.payment.status);
    }

    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(7).text('Thank you for your order!', { align: 'center' });

    return this.streamToBuffer(doc);
  }

  /**
   * A voucher-style PDF confirming a points-for-reward redemption — the
   * redemption's own id doubles as a verification code staff can check
   * against RewardRedemption.usedAt at the counter.
   */
  async generateRewardRedemptionPdf(redemptionId: string): Promise<Buffer> {
    const redemption = await this.prisma.rewardRedemption.findUniqueOrThrow({
      where: { id: redemptionId },
      include: { reward: true, customer: true },
    });
    const brand = await this.getBrand();

    const doc = this.newReceiptDoc(brand, 'REWARD VOUCHER');
    this.row(doc, 'Code', redemption.id.slice(0, 8).toUpperCase());
    this.row(doc, 'Date', new Date(redemption.redeemedAt).toLocaleString());
    this.row(doc, 'Customer', redemption.customer.name);
    doc.moveDown(0.3);
    this.divider(doc);

    doc.font('Helvetica-Bold').fontSize(10).text(redemption.reward.name, { align: 'center' });
    if (redemption.reward.description) {
      doc.font('Helvetica').fontSize(7).text(redemption.reward.description, { align: 'center' });
    }
    doc.moveDown(0.3);
    this.divider(doc);

    this.row(doc, 'Points spent', `${redemption.pointsSpent}`, { bold: true });
    this.row(doc, 'Redeemed', redemption.usedAt ? 'Already used' : 'Not yet used');

    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(7).text('Show this code at the counter to claim your reward.', { align: 'center' });

    return this.streamToBuffer(doc);
  }
}
