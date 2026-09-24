import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { RazorpayService } from '../payments/razorpay.service';
import { BusinessRulesService } from '../common/business-rules.service';
import { EmailService } from '../notifications/email.service';

type Tx = any;

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private razorpay: RazorpayService,
    private businessRules: BusinessRulesService,
    private email: EmailService,
  ) {}

  private async getOrCreateWallet(tx: Tx, customerId: string) {
    const existing = await tx.wallet.findUnique({ where: { customerId } });
    if (existing) return existing;
    return tx.wallet.create({ data: { customerId, balanceRs: 0 } });
  }

  async getBalance(prisma: Tx, customerId: string): Promise<number> {
    const wallet = await prisma.wallet.findUnique({ where: { customerId } });
    return wallet ? Number(wallet.balanceRs) : 0;
  }

  async credit(
    tx: Tx,
    params: { customerId: string; amountRs: number; type: 'REFUND' | 'ADMIN_ADJUSTMENT'; orderId?: string; refundId?: string; note?: string },
  ) {
    if (params.amountRs <= 0) throw new BadRequestException('Credit amount must be positive');

    const wallet = await this.getOrCreateWallet(tx, params.customerId);
    await tx.wallet.update({ where: { id: wallet.id }, data: { balanceRs: { increment: params.amountRs } } });
    return tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amountRs: params.amountRs,
        type: params.type,
        orderId: params.orderId,
        refundId: params.refundId,
        note: params.note,
      },
    });
  }

  async debit(tx: Tx, params: { customerId: string; amountRs: number; type: 'ORDER_PAYMENT' | 'TIP' | 'ADMIN_ADJUSTMENT'; orderId?: string; note?: string }) {
    if (params.amountRs <= 0) throw new BadRequestException('Debit amount must be positive');

    const wallet = await tx.wallet.findUnique({ where: { customerId: params.customerId } });
    const isExpired = !!(wallet?.expiresAt && new Date(wallet.expiresAt) < new Date());
    const balance = wallet && !isExpired ? Number(wallet.balanceRs) : 0;
    if (balance < params.amountRs) {
      const shortfall = (params.amountRs - balance).toFixed(2);
      throw new BadRequestException(
        isExpired
          ? `Your wallet package has expired. ₹${params.amountRs.toFixed(2)} additional payment required.`
          : `Insufficient wallet balance. ₹${shortfall} additional payment required.`,
      );
    }

    await tx.wallet.update({ where: { id: wallet.id }, data: { balanceRs: { decrement: params.amountRs } } });
    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amountRs: -params.amountRs,
        type: params.type,
        orderId: params.orderId,
        note: params.note,
      },
    });
    const balanceAfterRs = balance - params.amountRs;
    const rules = await this.businessRules.getRules();
    const crossedLowBalanceThreshold = balance >= rules.lowBalanceThresholdRs && balanceAfterRs < rules.lowBalanceThresholdRs;
    return { transaction, balanceBeforeRs: balance, balanceAfterRs, crossedLowBalanceThreshold };
  }

  async listTransactions(customerId: string, prisma: Tx) {
    const wallet = await prisma.wallet.findUnique({ where: { customerId } });
    if (!wallet) return [];
    return prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' } });
  }

  async getWalletOverview(customerId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { customerId } });
    const transactions = await this.listTransactions(customerId, this.prisma);
    const rules = await this.businessRules.getRules();
    const balanceRs = wallet ? Number(wallet.balanceRs) : 0;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todaysOrdersRs = transactions
      .filter((t: any) => t.type === 'ORDER_PAYMENT' && new Date(t.createdAt) >= startOfToday)
      .reduce((sum: number, t: any) => sum + Math.abs(Number(t.amountRs)), 0);

    return {
      balanceRs,
      activePackageName: wallet?.activePackageName ?? null,
      expiresAt: wallet?.expiresAt ?? null,
      isLowBalance: balanceRs < rules.lowBalanceThresholdRs,
      lowBalanceThresholdRs: rules.lowBalanceThresholdRs,
      todaysOrdersRs,
      todaysRemainingBalanceRs: balanceRs,
      transactions,
    };
  }

  async listPackages() {
    return this.prisma.walletPackage.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  async purchasePackage(customerId: string, packageId: string) {
    const pkg = await this.prisma.walletPackage.findUniqueOrThrow({ where: { id: packageId } });
    if (!pkg.isActive) throw new BadRequestException('This package is no longer available');

    const totalChargeRs = Number(pkg.priceRs) + Number(pkg.packageFeeRs);

    const paymentLink = await this.razorpay.createPaymentLink({
      amountRs: totalChargeRs,
      referenceId: `wallet-package:${customerId}:${pkg.id}`,
      description: `Panda Wallet — ${pkg.name}`,
    });

    return { paymentLinkId: paymentLink.id, shortUrl: paymentLink.short_url };
  }

  async confirmPackagePurchase(customerId: string, packageId: string) {
    const pkg = await this.prisma.walletPackage.findUnique({ where: { id: packageId } });
    if (!pkg) return;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + pkg.validityDays);

    return this.prisma.$transaction(async (tx: any) => {
      const wallet = await this.getOrCreateWallet(tx, customerId);
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceRs: { increment: Number(pkg.creditRs) }, expiresAt, activePackageName: pkg.name },
      });
      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amountRs: Number(pkg.creditRs),
          type: 'ADMIN_ADJUSTMENT',
          note: `Purchased ${pkg.name} package`,
        },
      });
    });
  }

  async sendDailyInvoices(now: Date = new Date()) {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const todaysDebits = await this.prisma.walletTransaction.findMany({
      where: { type: 'ORDER_PAYMENT', createdAt: { gte: startOfDay, lte: endOfDay } },
      include: { wallet: { include: { customer: { include: { user: true } } } } },
      orderBy: { createdAt: 'asc' },
    });

    const byWalletId = new Map<string, typeof todaysDebits>();
    for (const tx of todaysDebits) {
      if (!byWalletId.has(tx.walletId)) byWalletId.set(tx.walletId, []);
      byWalletId.get(tx.walletId)!.push(tx);
    }

    let sent = 0;
    for (const [, transactions] of byWalletId) {
      const wallet = transactions[0].wallet;
      const email = wallet.customer.user.email;
      if (!email) continue;

      const closingBalanceRs = Number(wallet.balanceRs);
      const todaysTotalRs = transactions.reduce((sum: number, t: { amountRs: unknown }) => sum + Math.abs(Number(t.amountRs)), 0);
      const openingBalanceRs = closingBalanceRs + todaysTotalRs;

      const orderIds = transactions.map((t: { orderId: string | null }) => t.orderId).filter((id: string | null): id is string => !!id);
      const orders = await this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: 'asc' },
      });

      const rowsHtml = orders
        .flatMap((o: any) =>
          o.items.map(
            (i: any) =>
              `<tr><td>${o.orderNumber}</td><td>${new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td><td>${i.product.name}</td><td>${i.quantity}</td><td>₹${(Number(i.unitPriceRs) * i.quantity).toFixed(2)}</td></tr>`,
          ),
        )
        .join('');

      await this.email.send({
        to: email,
        subject: `Protein Panda — Daily Wallet Invoice (${startOfDay.toLocaleDateString('en-IN')})`,
        html: `
          <h2>Protein Panda — Daily Invoice</h2>
          <p>Customer: ${wallet.customer.name}</p>
          <p>Plan: ${wallet.activePackageName ?? 'N/A'}</p>
          <p>Date: ${startOfDay.toLocaleDateString('en-IN')}</p>
          <table border="1" cellpadding="6" cellspacing="0">
            <tr><th>Order</th><th>Time</th><th>Item</th><th>Qty</th><th>Amount</th></tr>
            ${rowsHtml}
          </table>
          <p><strong>Today's Total: ₹${todaysTotalRs.toFixed(2)}</strong></p>
          <p>Opening Wallet: ₹${openingBalanceRs.toFixed(2)}</p>
          <p>Today's Deduction: ₹${todaysTotalRs.toFixed(2)}</p>
          <p><strong>Closing Wallet: ₹${closingBalanceRs.toFixed(2)}</strong></p>
        `,
      });

      await this.prisma.dailyBillingRecord.upsert({
        where: { customerId_billDate: { customerId: wallet.customerId, billDate: startOfDay } },
        create: {
          customerId: wallet.customerId,
          billDate: startOfDay,
          orderCount: orders.length,
          todaysTotalRs,
          openingBalanceRs,
          closingBalanceRs,
          emailSent: true,
        },
        update: {
          orderCount: orders.length,
          todaysTotalRs,
          openingBalanceRs,
          closingBalanceRs,
          emailSent: true,
        },
      });

      sent++;
    }

    return { invoicesSent: sent };
  }
}
