import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';

function makeTx(existingWallet: { id: string; balanceRs: number } | null = null) {
  return {
    wallet: {
      findUnique: jest.fn().mockResolvedValue(existingWallet),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'wallet-1', ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
    walletTransaction: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'wtx-1', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

describe('WalletService.credit', () => {
  it('rejects a non-positive credit amount', async () => {
    const service = new WalletService();
    const tx = makeTx();

    await expect(service.credit(tx, { customerId: 'cust-1', amountRs: 0, type: 'REFUND' })).rejects.toThrow(BadRequestException);
    await expect(service.credit(tx, { customerId: 'cust-1', amountRs: -10, type: 'REFUND' })).rejects.toThrow(BadRequestException);
  });

  it('creates a wallet on first use when none exists yet', async () => {
    const service = new WalletService();
    const tx = makeTx(null);

    await service.credit(tx, { customerId: 'cust-1', amountRs: 100, type: 'REFUND' });

    expect(tx.wallet.create).toHaveBeenCalledWith({ data: { customerId: 'cust-1', balanceRs: 0 } });
  });

  it('increments the existing balance rather than creating a duplicate wallet', async () => {
    const service = new WalletService();
    const tx = makeTx({ id: 'wallet-1', balanceRs: 50 });

    await service.credit(tx, { customerId: 'cust-1', amountRs: 100, type: 'REFUND' });

    expect(tx.wallet.create).not.toHaveBeenCalled();
    expect(tx.wallet.update).toHaveBeenCalledWith({ where: { id: 'wallet-1' }, data: { balanceRs: { increment: 100 } } });
  });

  it('records the transaction with a positive amount and links the order/refund it came from', async () => {
    const service = new WalletService();
    const tx = makeTx({ id: 'wallet-1', balanceRs: 0 });

    await service.credit(tx, { customerId: 'cust-1', amountRs: 75, type: 'REFUND', orderId: 'order-1', refundId: 'refund-1' });

    expect(tx.walletTransaction.create).toHaveBeenCalledWith({
      data: { walletId: 'wallet-1', amountRs: 75, type: 'REFUND', orderId: 'order-1', refundId: 'refund-1', note: undefined },
    });
  });
});

describe('WalletService.debit', () => {
  it('rejects a non-positive debit amount', async () => {
    const service = new WalletService();
    const tx = makeTx({ id: 'wallet-1', balanceRs: 100 });

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 0, type: 'ORDER_PAYMENT' })).rejects.toThrow(BadRequestException);
  });

  it('rejects a debit larger than the current balance — a wallet is spendable credit, not an overdraft', async () => {
    const service = new WalletService();
    const tx = makeTx({ id: 'wallet-1', balanceRs: 50 });

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 100, type: 'ORDER_PAYMENT' })).rejects.toThrow(/Insufficient wallet balance/);
  });

  it('rejects any debit at all when the customer has no wallet yet (balance is implicitly zero)', async () => {
    const service = new WalletService();
    const tx = makeTx(null);

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 10, type: 'ORDER_PAYMENT' })).rejects.toThrow(/Insufficient wallet balance/);
  });

  it('decrements the balance and records a negative-amount transaction for a valid debit', async () => {
    const service = new WalletService();
    const tx = makeTx({ id: 'wallet-1', balanceRs: 200 });

    await service.debit(tx, { customerId: 'cust-1', amountRs: 149, type: 'ORDER_PAYMENT', orderId: 'order-1' });

    expect(tx.wallet.update).toHaveBeenCalledWith({ where: { id: 'wallet-1' }, data: { balanceRs: { decrement: 149 } } });
    expect(tx.walletTransaction.create).toHaveBeenCalledWith({
      data: { walletId: 'wallet-1', amountRs: -149, type: 'ORDER_PAYMENT', orderId: 'order-1', note: undefined },
    });
  });

  it('allows a debit that exactly exhausts the balance', async () => {
    const service = new WalletService();
    const tx = makeTx({ id: 'wallet-1', balanceRs: 100 });

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 100, type: 'ORDER_PAYMENT' })).resolves.toBeDefined();
  });
});

describe('WalletService.getBalance', () => {
  it('returns 0 for a customer with no wallet yet, not an error', async () => {
    const service = new WalletService();
    const prisma = { wallet: { findUnique: jest.fn().mockResolvedValue(null) } } as any;

    const result = await service.getBalance(prisma, 'cust-1');

    expect(result).toBe(0);
  });

  it('returns the real numeric balance when a wallet exists', async () => {
    const service = new WalletService();
    const prisma = { wallet: { findUnique: jest.fn().mockResolvedValue({ balanceRs: 250 }) } } as any;

    const result = await service.getBalance(prisma, 'cust-1');

    expect(result).toBe(250);
  });
});
