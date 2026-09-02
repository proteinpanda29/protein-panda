import { BadRequestException, Injectable } from '@nestjs/common';

type Tx = any;

@Injectable()
export class WalletService {
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
   * credit, not a line of credit or an overdraft.
   */
  async debit(tx: Tx, params: { customerId: string; amountRs: number; type: 'ORDER_PAYMENT' | 'TIP' | 'ADMIN_ADJUSTMENT'; orderId?: string; note?: string }) {
    if (params.amountRs <= 0) throw new BadRequestException('Debit amount must be positive');

    const wallet = await tx.wallet.findUnique({ where: { customerId: params.customerId } });
    const balance = wallet ? Number(wallet.balanceRs) : 0;
    if (balance < params.amountRs) {
      throw new BadRequestException(`Insufficient wallet balance (₹${balance.toFixed(2)} available, ₹${params.amountRs.toFixed(2)} needed)`);
    }

    await tx.wallet.update({ where: { id: wallet.id }, data: { balanceRs: { decrement: params.amountRs } } });
    return tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amountRs: -params.amountRs,
        type: params.type,
        orderId: params.orderId,
        note: params.note,
      },
    });
  }

  async listTransactions(customerId: string, prisma: Tx) {
    const wallet = await prisma.wallet.findUnique({ where: { customerId } });
    if (!wallet) return [];
    return prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' } });
  }
}
