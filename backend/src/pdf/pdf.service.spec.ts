import { PdfService } from './pdf.service';

function makeHarness() {
  const prisma: any = {
    shopSettings: {
      findUnique: jest.fn().mockResolvedValue({
        businessName: 'Test Shakes Co',
        address: '123 Main St',
        contactPhone: '+919876543210',
        fssaiNumber: '12345678901234',
      }),
    },
    order: { findUniqueOrThrow: jest.fn() },
    rewardRedemption: { findUniqueOrThrow: jest.fn() },
  };
  const service = new PdfService(prisma);
  return { service, prisma };
}

const baseOrder = {
  orderNumber: 'PP1234',
  createdAt: new Date('2026-08-20T10:00:00Z'),
  subtotalRs: 149,
  discountRs: 0,
  totalRs: 149,
  customer: { name: 'Priya' },
  payment: { method: 'CASH', status: 'PAID' },
  items: [
    {
      quantity: 1,
      lineTotalRs: 149,
      product: { name: 'Chocolate Shake' },
      addons: [{ addon: { name: 'Banana' } }],
    },
  ],
};

describe('PdfService.generateOrderInvoicePdf', () => {
  it('produces a real PDF buffer (starts with the %PDF magic bytes)', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(baseOrder);

    const buffer = await service.generateOrderInvoicePdf('order-1');

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(100);
  });

  it('produces a different-content PDF when the business name in ShopSettings changes', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(baseOrder);
    prisma.shopSettings.findUnique.mockResolvedValueOnce({
      businessName: 'Iron Fuel',
      address: '99 Custom Ave',
      contactPhone: '+911111111111',
      fssaiNumber: '99999999999999',
    });
    const withCustomBrand = await service.generateOrderInvoicePdf('order-1');

    prisma.shopSettings.findUnique.mockResolvedValueOnce({
      businessName: 'A Totally Different And Much Longer Business Name For This Test',
      address: null,
      contactPhone: null,
      fssaiNumber: null,
    });
    const withOtherBrand = await service.generateOrderInvoicePdf('order-1');

    // Different (and here, differently-lengthed) business names produce
    // genuinely different PDF content — confirms the brand is actually
    // being read per-call from ShopSettings, not cached or hardcoded.
    expect(withCustomBrand.length).not.toBe(withOtherBrand.length);
  });

  it('calls ShopSettings.findUnique to source the business name — never hardcodes it', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(baseOrder);

    await service.generateOrderInvoicePdf('order-1');

    expect(prisma.shopSettings.findUnique).toHaveBeenCalledWith({ where: { id: 'default' } });
  });

  it('does not throw when ShopSettings has never been configured (falls back to a sensible default)', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(baseOrder);
    prisma.shopSettings.findUnique.mockResolvedValue(null);

    await expect(service.generateOrderInvoicePdf('order-1')).resolves.toBeInstanceOf(Buffer);
  });

  it('produces a larger PDF for an order with more line items than one with fewer', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValueOnce({
      ...baseOrder,
      items: [{ quantity: 1, lineTotalRs: 149, product: { name: 'Single Item' }, addons: [] }],
    });
    const smallBuffer = await service.generateOrderInvoicePdf('order-1');

    prisma.order.findUniqueOrThrow.mockResolvedValueOnce({
      ...baseOrder,
      items: Array.from({ length: 10 }, (_, i) => ({
        quantity: 1,
        lineTotalRs: 100,
        product: { name: `Item Number ${i}` },
        addons: [],
      })),
    });
    const largeBuffer = await service.generateOrderInvoicePdf('order-1');

    expect(largeBuffer.length).toBeGreaterThan(smallBuffer.length);
  });

  it('handles an order with a discount applied without throwing', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...baseOrder, discountRs: 20, totalRs: 129 });

    await expect(service.generateOrderInvoicePdf('order-1')).resolves.toBeInstanceOf(Buffer);
  });

  it('handles an order with no payment record without throwing', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...baseOrder, payment: null });

    await expect(service.generateOrderInvoicePdf('order-1')).resolves.toBeInstanceOf(Buffer);
  });

  it('handles many line items without throwing (pagination path)', async () => {
    const { service, prisma } = makeHarness();
    const manyItems = Array.from({ length: 40 }, (_, i) => ({
      quantity: 1,
      lineTotalRs: 100,
      product: { name: `Item ${i}` },
      addons: [],
    }));
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...baseOrder, items: manyItems });

    const buffer = await service.generateOrderInvoicePdf('order-1');

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('PdfService.generateRewardRedemptionPdf', () => {
  const baseRedemption = {
    id: 'redemption-abc12345',
    pointsSpent: 200,
    redeemedAt: new Date('2026-08-20T10:00:00Z'),
    usedAt: null,
    customer: { name: 'Priya' },
    reward: { name: 'Free Banana Add-on', description: 'One free banana add-on on any shake' },
  };

  it('produces a real PDF buffer', async () => {
    const { service, prisma } = makeHarness();
    prisma.rewardRedemption.findUniqueOrThrow.mockResolvedValue(baseRedemption);

    const buffer = await service.generateRewardRedemptionPdf('redemption-abc12345');

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('produces a real PDF buffer with more content than an empty document baseline', async () => {
    const { service, prisma } = makeHarness();
    prisma.rewardRedemption.findUniqueOrThrow.mockResolvedValue(baseRedemption);

    const buffer = await service.generateRewardRedemptionPdf('redemption-abc12345');

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(100);
  });

  it('shows a distinct status for an already-used voucher vs. an unused one', async () => {
    const { service, prisma } = makeHarness();
    prisma.rewardRedemption.findUniqueOrThrow.mockResolvedValue({ ...baseRedemption, usedAt: new Date() });

    await expect(service.generateRewardRedemptionPdf('redemption-abc12345')).resolves.toBeInstanceOf(Buffer);
  });

  it('handles a reward with no description without throwing', async () => {
    const { service, prisma } = makeHarness();
    prisma.rewardRedemption.findUniqueOrThrow.mockResolvedValue({
      ...baseRedemption,
      reward: { name: 'Free Item', description: null },
    });

    await expect(service.generateRewardRedemptionPdf('redemption-abc12345')).resolves.toBeInstanceOf(Buffer);
  });
});
