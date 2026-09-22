import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { RazorpayService } from '../payments/razorpay.service';
import { BusinessRulesService } from '../common/business-rules.service';

type Tx = any;

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private razorpay: RazorpayService,
    private businessRules: BusinessRulesService,
  ) {}

  /** Creates the wallet on first use — most customers will never need one, so it's not created at signup. */
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

  /**
   * Used to pay for an order. Throws on insufficient balance rather
   * than allowing a wallet to go negative — a wallet is spendable
   * credit, not a line of credit or an overdraft. Balance past a
   * package's own expiresAt is treated as unusable (0), per the
   * finalized spec's own validity-window design — a wallet that's
   * never bought a package (expiresAt null) has no expiry to check
   * at all.
   */
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
    // Balance before/after included specifically for callers building a
    // wallet-order receipt (see the finalized spec: the email needs to
    // show both) — avoids a second query right after this one for
    // something already known here.
    const balanceAfterRs = balance - params.amountRs;
    // Same "just crossed" detection as the low-stock alert — only true
    // the one debit that pushes the balance under the threshold, not
    // every debit afterward while it stays low, so this never fires a
    // fresh warning on every single order once a customer is already
    // running low.
    const rules = await this.businessRules.getRules();
    const crossedLowBalanceThreshold = balance >= rules.lowBalanceThresholdRs && balanceAfterRs < rules.lowBalanceThresholdRs;
    return { transaction, balanceBeforeRs: balance, balanceAfterRs, crossedLowBalanceThreshold };
  }

  async listTransactions(customerId: string, prisma: Tx) {
    const wallet = await prisma.wallet.findUnique({ where: { customerId } });
    if (!wallet) return [];
    return prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' } });
  }

  /** The customer-facing wallet screen — balance, active package, expiry, low-balance warning, and a full transaction list in one call. */
  async getWalletOverview(customerId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { customerId } });
    const transactions = await this.listTransactions(customerId, this.prisma);
    const rules = await this.businessRules.getRules();
    const balanceRs = wallet ? Number(wallet.balanceRs) : 0;
    return {
      balanceRs,
      activePackageName: wallet?.activePackageName ?? null,
      expiresAt: wallet?.expiresAt ?? null,
      // Computed live every time this is called, not a stored flag —
      // always reflects the real current balance, including going back
      // to false again the moment a top-up brings it back over the
      // threshold, with nothing to separately reset.
      isLowBalance: balanceRs < rules.lowBalanceThresholdRs,
      lowBalanceThresholdRs: rules.lowBalanceThresholdRs,
      transactions,
    };
  }

  async listPackages() {
    return this.prisma.walletPackage.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  /**
   * Real money changing hands — a Razorpay Payment Link, same pattern
   * as the tip-via-UPI and cash-collection-via-UPI flows. The wallet
   * is only actually credited once Razorpay confirms payment (see
   * confirmPackagePurchase), never optimistically here.
   */
  async purchasePackage(customerId: string, packageId: string) {
    const pkg = await this.prisma.walletPackage.findUniqueOrThrow({ where: { id: packageId } });
    if (!pkg.isActive) throw new BadRequestException('This package is no longer available');

    const paymentLink = await this.razorpay.createPaymentLink({
      amountRs: Number(pkg.priceRs),
      referenceId: `wallet-package:${customerId}:${pkg.id}`,
      description: `Panda Wallet — ${pkg.name}`,
    });

    return { paymentLinkId: paymentLink.id, shortUrl: paymentLink.short_url };
  }

  /**
   * Called from the payments webhook once Razorpay confirms a wallet
   * package purchase was actually paid — parses the customer and
   * package back out of the reference_id purchasePackage encoded.
   * Buying a new package while one is still active simply adds this
   * package's credit on top of any remaining balance and resets the
   * expiry to a fresh window from now, rather than trying to merge or
   * stack two different validity windows.
   */
  async confirmPackagePurchase(customerId: string, packageId: string) {
    const pkg = await this.prisma.walletPackage.findUnique({ where: { id: packageId } });
    if (!pkg) return; // a package that's since been deleted — nothing sensible to credit

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
          type: 'ADMIN_ADJUSTMENT', // closest existing type — a real "PACKAGE_PURCHASE" type would need its own migration
          note: `Purchased ${pkg.name} package`,
        },
      });
    });
  }
}
