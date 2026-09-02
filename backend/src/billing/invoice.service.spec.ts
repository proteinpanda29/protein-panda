import { InvoiceService } from './invoice.service';

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    customerId: 'cust-1',
    orderNumber: 'PP1234',
    createdAt: new Date('2026-08-17T10:00:00Z'),
    subtotalRs: 149,
    discountRs: 0,
    totalRs: 149,
    totalProteinG: 30,
    totalCalories: 320,
    payment: { method: 'CASH', status: 'PAID' },
    items: [
      {
        product: { name: 'Chocolate Protein Shake' },
        quantity: 1,
        lineTotalRs: 149,
        addons: [{ addon: { name: 'Banana' } }],
      },
    ],
    customer: { user: { email: 'customer@example.com', phone: null } },
    ...overrides,
  };
}

function makeHarness() {
  const prisma = {
    order: { findUniqueOrThrow: jest.fn() },
    shopSettings: { findUnique: jest.fn().mockResolvedValue({ businessName: 'Protein Panda', tagline: null, primaryColorHex: '#6F8615' }) },
  } as any;
  const email = { send: jest.fn().mockResolvedValue(true) } as any;
  const service = new InvoiceService(prisma, email);
  return { service, prisma, email };
}

describe('InvoiceService.generateInvoiceHtml', () => {
  it('includes the order number, items, addons, and total', () => {
    const { service } = makeHarness();
    const html = service.generateInvoiceHtml(makeOrder() as any);

    expect(html).toContain('PP1234');
    expect(html).toContain('Chocolate Protein Shake');
    expect(html).toContain('Banana');
    expect(html).toContain('149.00');
  });

  it('shows the discount line only when a discount was applied', () => {
    const { service } = makeHarness();
    const withDiscount = service.generateInvoiceHtml(makeOrder({ discountRs: 20, totalRs: 129 }) as any);
    const withoutDiscount = service.generateInvoiceHtml(makeOrder() as any);

    expect(withDiscount).toContain('Discount');
    expect(withoutDiscount).not.toContain('Discount');
  });
});

describe('InvoiceService.sendInvoiceEmail', () => {
  it('sends to the customer email when one is on file', async () => {
    const { service, prisma, email } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder());

    await service.sendInvoiceEmail('order-1');

    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'customer@example.com', subject: expect.stringContaining('PP1234') }),
    );
  });

  it('skips sending (without throwing) when the customer signed up with phone only', async () => {
    const { service, prisma, email } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ customer: { user: { email: null, phone: '+919876543210' } } }));

    await expect(service.sendInvoiceEmail('order-1')).resolves.toBeUndefined();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('never throws even if the order lookup fails', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockRejectedValue(new Error('order not found'));

    await expect(service.sendInvoiceEmail('missing-order')).resolves.toBeUndefined();
  });
});

describe('InvoiceService.getInvoiceData', () => {
  it('rejects when the order does not belong to the requesting customer', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder({ customerId: 'cust-OTHER' }));

    await expect(service.getInvoiceData('cust-1', 'order-1')).rejects.toThrow();
  });
});

describe('InvoiceService — white-label branding', () => {
  it('generateInvoiceHtml renders the configured business name and primary color, not a hardcoded one', () => {
    const { service } = makeHarness();

    const html = service.generateInvoiceHtml(makeOrder() as any, {
      businessName: 'Iron Fuel',
      tagline: 'Strength in every sip',
      primaryColorHex: '#112233',
    });

    expect(html).toContain('Iron Fuel');
    expect(html).toContain('#112233');
    expect(html).toContain('Strength in every sip');
    expect(html).not.toContain('Protein Panda');
    expect(html).not.toContain('🐼');
  });

  it('sendInvoiceEmail fetches the configured business name and uses it in the subject and sender', async () => {
    const { service, prisma, email } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder());
    prisma.shopSettings.findUnique.mockResolvedValue({ businessName: 'Iron Fuel', tagline: null, primaryColorHex: '#112233' });

    await service.sendInvoiceEmail('order-1');

    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('Iron Fuel'), fromName: 'Iron Fuel' }),
    );
  });

  it('sendInvoiceEmail falls back to "Protein Panda" if shop settings have never been configured', async () => {
    const { service, prisma, email } = makeHarness();
    prisma.order.findUniqueOrThrow.mockResolvedValue(makeOrder());
    prisma.shopSettings.findUnique.mockResolvedValue(null);

    await service.sendInvoiceEmail('order-1');

    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ fromName: 'Protein Panda' }));
  });
});
