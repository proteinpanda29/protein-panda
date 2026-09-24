import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';

// The existing credit/debit/listTransactions tests below only ever use
// the tx/prisma parameter passed directly into each method call — the
// constructor-injected prisma/razorpay (needed only by the newer
// package-purchase methods) are never actually touched by them, so
// empty mocks are enough here.
const mockPrisma = {} as any;
const mockRazorpay = {} as any;
const mockBusinessRules = { getRules: jest.fn().mockResolvedValue({ lowBalanceThresholdRs: 300 }) } as any;
const mockEmail = { send: jest.fn().mockResolvedValue(true) } as any;

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
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx();

    await expect(service.credit(tx, { customerId: 'cust-1', amountRs: 0, type: 'REFUND' })).rejects.toThrow(BadRequestException);
    await expect(service.credit(tx, { customerId: 'cust-1', amountRs: -10, type: 'REFUND' })).rejects.toThrow(BadRequestException);
  });

  it('creates a wallet on first use when none exists yet', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx(null);

    await service.credit(tx, { customerId: 'cust-1', amountRs: 100, type: 'REFUND' });

    expect(tx.wallet.create).toHaveBeenCalledWith({ data: { customerId: 'cust-1', balanceRs: 0 } });
  });

  it('increments the existing balance rather than creating a duplicate wallet', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 50 });

    await service.credit(tx, { customerId: 'cust-1', amountRs: 100, type: 'REFUND' });

    expect(tx.wallet.create).not.toHaveBeenCalled();
    expect(tx.wallet.update).toHaveBeenCalledWith({ where: { id: 'wallet-1' }, data: { balanceRs: { increment: 100 } } });
  });

  it('records the transaction with a positive amount and links the order/refund it came from', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 0 });

    await service.credit(tx, { customerId: 'cust-1', amountRs: 75, type: 'REFUND', orderId: 'order-1', refundId: 'refund-1' });

    expect(tx.walletTransaction.create).toHaveBeenCalledWith({
      data: { walletId: 'wallet-1', amountRs: 75, type: 'REFUND', orderId: 'order-1', refundId: 'refund-1', note: undefined },
    });
  });
});

describe('WalletService.debit', () => {
  it('rejects a non-positive debit amount', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 100 });

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 0, type: 'ORDER_PAYMENT' })).rejects.toThrow(BadRequestException);
  });

  it('rejects a debit larger than the current balance — a wallet is spendable credit, not an overdraft', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 50 });

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 100, type: 'ORDER_PAYMENT' })).rejects.toThrow(/Insufficient wallet balance/);
  });

  it('rejects any debit at all when the customer has no wallet yet (balance is implicitly zero)', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx(null);

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 10, type: 'ORDER_PAYMENT' })).rejects.toThrow(/Insufficient wallet balance/);
  });

  it('decrements the balance and records a negative-amount transaction for a valid debit', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 200 });

    await service.debit(tx, { customerId: 'cust-1', amountRs: 149, type: 'ORDER_PAYMENT', orderId: 'order-1' });

    expect(tx.wallet.update).toHaveBeenCalledWith({ where: { id: 'wallet-1' }, data: { balanceRs: { decrement: 149 } } });
    expect(tx.walletTransaction.create).toHaveBeenCalledWith({
      data: { walletId: 'wallet-1', amountRs: -149, type: 'ORDER_PAYMENT', orderId: 'order-1', note: undefined },
    });
  });

  it('returns the balance before and after the debit, for building a wallet-order receipt', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 500 });

    const result = await service.debit(tx, { customerId: 'cust-1', amountRs: 150, type: 'ORDER_PAYMENT' });

    expect(result.balanceBeforeRs).toBe(500);
    expect(result.balanceAfterRs).toBe(350);
  });

  it('allows a debit that exactly exhausts the balance', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 100 });

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 100, type: 'ORDER_PAYMENT' })).resolves.toBeDefined();
  });
});

describe('WalletService.getBalance', () => {
  it('returns 0 for a customer with no wallet yet, not an error', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const prisma = { wallet: { findUnique: jest.fn().mockResolvedValue(null) } } as any;

    const result = await service.getBalance(prisma, 'cust-1');

    expect(result).toBe(0);
  });

  it('returns the real numeric balance when a wallet exists', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const prisma = { wallet: { findUnique: jest.fn().mockResolvedValue({ balanceRs: 250 }) } } as any;

    const result = await service.getBalance(prisma, 'cust-1');

    expect(result).toBe(250);
  });
});

describe('WalletService.debit — expiry-aware', () => {
  it('debits normally from a wallet with no expiry set at all', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 200 });

    await service.debit(tx, { customerId: 'cust-1', amountRs: 50, type: 'ORDER_PAYMENT' });

    expect(tx.wallet.update).toHaveBeenCalledWith({ where: { id: 'wallet-1' }, data: { balanceRs: { decrement: 50 } } });
  });

  it('debits normally when the package expiry is still in the future', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5); // 5 days from now
    const tx = makeTx({ id: 'wallet-1', balanceRs: 200, expiresAt: future } as any);

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 50, type: 'ORDER_PAYMENT' })).resolves.toBeDefined();
  });

  it('treats an expired package balance as unusable, even though the raw balanceRs is still positive', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24); // yesterday
    const tx = makeTx({ id: 'wallet-1', balanceRs: 200, expiresAt: past } as any);

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 50, type: 'ORDER_PAYMENT' })).rejects.toThrow(/package has expired/i);
  });

  it('states how much additional payment is required in the insufficient-balance message', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 100 });

    await expect(service.debit(tx, { customerId: 'cust-1', amountRs: 150, type: 'ORDER_PAYMENT' })).rejects.toThrow(/₹50\.00 additional payment required/i);
  });
});

describe('WalletService.purchasePackage', () => {
  it('creates a real Razorpay Payment Link for the exact package price when there is no package/delivery fee, encoding customer+package in the reference id', async () => {
    const prisma = { walletPackage: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'pkg-1', name: 'Monthly ₹9,000', priceRs: 9000, creditRs: 9000, packageFeeRs: 0, validityDays: 30, isActive: true }) } } as any;
    const razorpay = { createPaymentLink: jest.fn().mockResolvedValue({ id: 'plink_1', short_url: 'https://rzp.io/i/abc' }) } as any;
    const service = new WalletService(prisma, razorpay, mockBusinessRules, mockEmail);

    const result = await service.purchasePackage('cust-1', 'pkg-1');

    expect(razorpay.createPaymentLink).toHaveBeenCalledWith({
      amountRs: 9000,
      referenceId: 'wallet-package:cust-1:pkg-1',
      description: 'Panda Wallet — Monthly ₹9,000',
    });
    expect(result).toEqual({ paymentLinkId: 'plink_1', shortUrl: 'https://rzp.io/i/abc' });
  });

  it('charges the package price PLUS the discounted package/delivery fee together as one payment, matching the finalized subscription policy', async () => {
    const prisma = { walletPackage: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'pkg-1', name: 'Weekly Basic', priceRs: 1499, creditRs: 1499, packageFeeRs: 25, validityDays: 7, isActive: true }) } } as any;
    const razorpay = { createPaymentLink: jest.fn().mockResolvedValue({ id: 'plink_1', short_url: 'https://rzp.io/i/abc' }) } as any;
    const service = new WalletService(prisma, razorpay, mockBusinessRules, mockEmail);

    await service.purchasePackage('cust-1', 'pkg-1');

    expect(razorpay.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ amountRs: 1524 }), // 1499 + 25
    );
  });

  it('never credits the package/delivery fee to the food wallet — only creditRs lands there', async () => {
    const tx = makeTx(null);
    const prisma = {
      walletPackage: { findUnique: jest.fn().mockResolvedValue({ id: 'pkg-1', name: 'Weekly Basic', creditRs: 1499, packageFeeRs: 25, validityDays: 7 }) },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, mockEmail);

    await service.confirmPackagePurchase('cust-1', 'pkg-1');

    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ balanceRs: { increment: 1499 } }) }),
    );
  });

  it('refuses to sell a package that has been disabled', async () => {
    const prisma = { walletPackage: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'pkg-1', isActive: false }) } } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, mockEmail);

    await expect(service.purchasePackage('cust-1', 'pkg-1')).rejects.toThrow(/no longer available/i);
  });
});

describe('WalletService.confirmPackagePurchase', () => {
  it('credits the exact package amount and sets expiry to validityDays from now', async () => {
    const tx = makeTx(null);
    const prisma = {
      walletPackage: { findUnique: jest.fn().mockResolvedValue({ id: 'pkg-1', name: 'Weekly ₹2,000', creditRs: 2000, validityDays: 7 }) },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
    } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, mockEmail);

    await service.confirmPackagePurchase('cust-1', 'pkg-1');

    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ balanceRs: { increment: 2000 }, activePackageName: 'Weekly ₹2,000' }),
      }),
    );
    const call = tx.wallet.update.mock.calls[0][0];
    const daysUntilExpiry = Math.round((call.data.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    expect(daysUntilExpiry).toBe(7);
  });

  it('does nothing and does not throw when the package no longer exists (e.g. deleted after purchase but before webhook)', async () => {
    const prisma = { walletPackage: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, mockEmail);

    await expect(service.confirmPackagePurchase('cust-1', 'ghost-pkg')).resolves.toBeUndefined();
  });
});

describe('WalletService.getWalletOverview', () => {
  it('returns balance, active package name, expiry, and transactions together', async () => {
    const prisma = {
      wallet: { findUnique: jest.fn().mockResolvedValue({ balanceRs: 8180, activePackageName: 'Monthly ₹9,000', expiresAt: new Date('2026-10-22') }) },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([{ id: 'wtx-1' }]) },
    } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, mockEmail);

    const result = await service.getWalletOverview('cust-1');

    expect(result).toEqual({
      balanceRs: 8180,
      activePackageName: 'Monthly ₹9,000',
      expiresAt: new Date('2026-10-22'),
      isLowBalance: false,
      lowBalanceThresholdRs: 300,
      todaysOrdersRs: 0,
      todaysRemainingBalanceRs: 8180,
      transactions: [{ id: 'wtx-1' }],
    });
  });

  it('computes todaysOrdersRs from only today\'s ORDER_PAYMENT transactions, ignoring older ones and other types', async () => {
    const todayIso = new Date().toISOString();
    const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    const prisma = {
      wallet: { findUnique: jest.fn().mockResolvedValue({ balanceRs: 500, activePackageName: null, expiresAt: null }) },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'wtx-1', type: 'ORDER_PAYMENT', amountRs: -100, createdAt: todayIso },
          { id: 'wtx-2', type: 'ORDER_PAYMENT', amountRs: -50, createdAt: todayIso },
          { id: 'wtx-3', type: 'ORDER_PAYMENT', amountRs: -80, createdAt: yesterday },
          { id: 'wtx-4', type: 'ADMIN_ADJUSTMENT', amountRs: 1000, createdAt: todayIso },
        ]),
      },
    } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, mockEmail);

    const result = await service.getWalletOverview('cust-1');

    expect(result.todaysOrdersRs).toBe(150);
    expect(result.todaysRemainingBalanceRs).toBe(500);
  });

  it('returns zero balance and no package for a customer with no wallet yet, rather than throwing', async () => {
    const prisma = {
      wallet: { findUnique: jest.fn().mockResolvedValue(null) },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, mockEmail);

    const result = await service.getWalletOverview('cust-1');

    expect(result.balanceRs).toBe(0);
    expect(result.activePackageName).toBeNull();
  });

  it('marks isLowBalance true when the real current balance is under the admin-configured threshold', async () => {
    const prisma = {
      wallet: { findUnique: jest.fn().mockResolvedValue({ balanceRs: 150, activePackageName: null, expiresAt: null }) },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, mockEmail);

    const result = await service.getWalletOverview('cust-1');

    expect(result.isLowBalance).toBe(true);
  });

  it('marks isLowBalance false once balance is back at or above the threshold — always live, never a stuck flag', async () => {
    const prisma = {
      wallet: { findUnique: jest.fn().mockResolvedValue({ balanceRs: 300, activePackageName: null, expiresAt: null }) },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, mockEmail);

    const result = await service.getWalletOverview('cust-1');

    expect(result.isLowBalance).toBe(false);
  });
});

describe('WalletService.debit — low-balance crossing detection', () => {
  it('reports crossedLowBalanceThreshold true only the debit that pushes balance under the threshold', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 350 });

    const result = await service.debit(tx, { customerId: 'cust-1', amountRs: 100, type: 'ORDER_PAYMENT' });

    expect(result.crossedLowBalanceThreshold).toBe(true);
  });

  it('does not report a crossing when the balance was already under the threshold before this debit', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 250 });

    const result = await service.debit(tx, { customerId: 'cust-1', amountRs: 50, type: 'ORDER_PAYMENT' });

    expect(result.crossedLowBalanceThreshold).toBe(false);
  });

  it('does not report a crossing when the balance stays above the threshold after this debit', async () => {
    const service = new WalletService(mockPrisma, mockRazorpay, mockBusinessRules, mockEmail);
    const tx = makeTx({ id: 'wallet-1', balanceRs: 1000 });

    const result = await service.debit(tx, { customerId: 'cust-1', amountRs: 50, type: 'ORDER_PAYMENT' });

    expect(result.crossedLowBalanceThreshold).toBe(false);
  });
});

describe('WalletService.sendDailyInvoices', () => {
  function makeDailyPrisma(transactions: any[], orders: any[] = []) {
    return {
      walletTransaction: { findMany: jest.fn().mockResolvedValue(transactions) },
      order: { findMany: jest.fn().mockResolvedValue(orders) },
      dailyBillingRecord: { upsert: jest.fn().mockResolvedValue({}) },
    } as any;
  }

  it('sends one consolidated email covering every order a customer placed that day', async () => {
    const wallet = { balanceRs: 999, activePackageName: 'Weekly Basic', customer: { name: 'Kiruba', user: { email: 'kiruba@example.com' } } };
    const prisma = makeDailyPrisma(
      [
        { walletId: 'wallet-1', orderId: 'order-1', amountRs: -129, wallet },
        { walletId: 'wallet-1', orderId: 'order-2', amountRs: -236, wallet },
      ],
      [
        { id: 'order-1', orderNumber: 'PP0001', createdAt: new Date(), items: [{ quantity: 1, unitPriceRs: 129, product: { name: 'Protein Shake' } }] },
        { id: 'order-2', orderNumber: 'PP0002', createdAt: new Date(), items: [{ quantity: 1, unitPriceRs: 236, product: { name: 'Chicken Tandoori' } }] },
      ],
    );
    const email = { send: jest.fn().mockResolvedValue(true) } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, email);

    const result = await service.sendDailyInvoices(new Date('2026-09-24'));

    expect(email.send).toHaveBeenCalledTimes(1);
    expect(result.invoicesSent).toBe(1);
    const call = email.send.mock.calls[0][0];
    expect(call.to).toBe('kiruba@example.com');
    expect(call.html).toContain('Protein Shake');
    expect(call.html).toContain('Chicken Tandoori');
  });

  it('computes the opening balance correctly as closing balance plus everything spent today', async () => {
    const wallet = { balanceRs: 999, activePackageName: 'Weekly Basic', customer: { name: 'Kiruba', user: { email: 'kiruba@example.com' } } };
    const prisma = makeDailyPrisma([
      { walletId: 'wallet-1', orderId: 'order-1', amountRs: -129, wallet },
      { walletId: 'wallet-1', orderId: 'order-2', amountRs: -236, wallet },
    ]);
    const email = { send: jest.fn().mockResolvedValue(true) } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, email);

    await service.sendDailyInvoices(new Date('2026-09-24'));

    const html = email.send.mock.calls[0][0].html;
    // opening 999 + 365 spent = 1364
    expect(html).toContain('1364.00');
    expect(html).toContain('365.00');
    expect(html).toContain('999.00');
  });

  it('sends nothing at all for a customer with no wallet orders today — no order, no invoice noise', async () => {
    const prisma = makeDailyPrisma([]);
    const email = { send: jest.fn().mockResolvedValue(true) } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, email);

    const result = await service.sendDailyInvoices(new Date('2026-09-24'));

    expect(email.send).not.toHaveBeenCalled();
    expect(result.invoicesSent).toBe(0);
  });

  it('skips a customer with no email on file rather than throwing', async () => {
    const wallet = { balanceRs: 500, activePackageName: null, customer: { name: 'No Email Guy', user: { email: null } } };
    const prisma = makeDailyPrisma([{ walletId: 'wallet-1', orderId: 'order-1', amountRs: -50, wallet }]);
    const email = { send: jest.fn().mockResolvedValue(true) } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, email);

    const result = await service.sendDailyInvoices(new Date('2026-09-24'));

    expect(email.send).not.toHaveBeenCalled();
    expect(result.invoicesSent).toBe(0);
  });

  it('persists a real DailyBillingRecord row for admin visibility, not just sending the email', async () => {
    const wallet = { customerId: 'cust-1', balanceRs: 999, activePackageName: 'Weekly Basic', customer: { name: 'Kiruba', user: { email: 'kiruba@example.com' } } };
    const prisma = makeDailyPrisma([
      { walletId: 'wallet-1', orderId: 'order-1', amountRs: -129, wallet },
      { walletId: 'wallet-1', orderId: 'order-2', amountRs: -236, wallet },
    ]);
    const email = { send: jest.fn().mockResolvedValue(true) } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, email);

    await service.sendDailyInvoices(new Date('2026-09-24'));

    expect(prisma.dailyBillingRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId_billDate: { customerId: 'cust-1', billDate: expect.any(Date) } },
        create: expect.objectContaining({
          customerId: 'cust-1',
          orderCount: 0, // no matching orders in this test's mocked order.findMany
          todaysTotalRs: 365,
          openingBalanceRs: 1364,
          closingBalanceRs: 999,
          emailSent: true,
        }),
      }),
    );
  });

  it('sends a separate invoice per customer when multiple customers ordered the same day', async () => {
    const walletA = { balanceRs: 999, activePackageName: 'Weekly Basic', customer: { name: 'Kiruba', user: { email: 'kiruba@example.com' } } };
    const walletB = { balanceRs: 500, activePackageName: 'Monthly Pro', customer: { name: 'Anand', user: { email: 'anand@example.com' } } };
    const prisma = makeDailyPrisma([
      { walletId: 'wallet-1', orderId: 'order-1', amountRs: -100, wallet: walletA },
      { walletId: 'wallet-2', orderId: 'order-2', amountRs: -200, wallet: walletB },
    ]);
    const email = { send: jest.fn().mockResolvedValue(true) } as any;
    const service = new WalletService(prisma, mockRazorpay, mockBusinessRules, email);

    const result = await service.sendDailyInvoices(new Date('2026-09-24'));

    expect(email.send).toHaveBeenCalledTimes(2);
    expect(result.invoicesSent).toBe(2);
  });
});
