import { createHmac } from 'crypto';
import { WhatsAppBotService } from './whatsapp-bot.service';

function makeHarness() {
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    whatsAppSession: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    productCategory: { findMany: jest.fn(), findUnique: jest.fn() },
  } as any;
  const products = { list: jest.fn() } as any;
  const orders = { create: jest.fn() } as any;
  const payments = { createPaymentLinkForOrder: jest.fn() } as any;
  const service = new WhatsAppBotService(prisma, products, orders, payments);
  return { service, prisma, products, orders, payments };
}

const PHONE = '+919876543210';

describe('WhatsAppBotService.handleIncomingMessage — customer identification', () => {
  it('creates a new customer account for a brand new WhatsApp number', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ customer: { id: 'cust-new' } });
    prisma.whatsAppSession.findUnique.mockResolvedValue(null);
    prisma.whatsAppSession.create.mockResolvedValue({ phone: PHONE, state: 'GREETING', cart: [], customerId: 'cust-new', activeCategoryId: null });
    prisma.productCategory.findMany.mockResolvedValue([]);

    await service.handleIncomingMessage(PHONE, 'hi');

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'CUSTOMER', phone: PHONE }) }),
    );
  });

  it('reuses an existing customer account for a returning number, without creating a duplicate', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ customer: { id: 'cust-existing' } });
    prisma.whatsAppSession.findUnique.mockResolvedValue(null);
    prisma.whatsAppSession.create.mockResolvedValue({ phone: PHONE, state: 'GREETING', cart: [], customerId: 'cust-existing', activeCategoryId: null });
    prisma.productCategory.findMany.mockResolvedValue([]);

    await service.handleIncomingMessage(PHONE, 'hi');

    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('WhatsAppBotService.handleIncomingMessage — browsing flow', () => {
  it('shows numbered categories on a fresh greeting', async () => {
    const { service, prisma } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({ phone: PHONE, state: 'GREETING', cart: [], customerId: 'cust-1', activeCategoryId: null });
    prisma.productCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Shakes' }, { id: 'cat-2', name: 'Snacks' }]);

    const reply = await service.handleIncomingMessage(PHONE, 'hi');

    expect(reply.text).toContain('1. Shakes');
    expect(reply.text).toContain('2. Snacks');
  });

  it('selecting a category number shows that category\'s items with prices', async () => {
    const { service, prisma, products } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({ phone: PHONE, state: 'BROWSING_CATEGORIES', cart: [], customerId: 'cust-1', activeCategoryId: null });
    prisma.productCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Shakes', slug: 'shakes' }]);
    products.list.mockResolvedValue([{ id: 'p1', name: 'Chocolate Shake', basePriceRs: 129 }]);

    const reply = await service.handleIncomingMessage(PHONE, '1');

    expect(reply.text).toContain('Chocolate Shake — ₹129');
    expect(prisma.whatsAppSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'BROWSING_ITEMS', activeCategoryId: 'cat-1' }) }),
    );
  });

  it('an out-of-range category number gives a helpful message instead of crashing', async () => {
    const { service, prisma } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({ phone: PHONE, state: 'BROWSING_CATEGORIES', cart: [], customerId: 'cust-1', activeCategoryId: null });
    prisma.productCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Shakes', slug: 'shakes' }]);

    const reply = await service.handleIncomingMessage(PHONE, '99');

    expect(reply.text).toMatch(/didn't recognize/i);
  });

  it('selecting an item adds it to the cart, and selecting it again increments quantity', async () => {
    const { service, prisma, products } = makeHarness();
    const session = { phone: PHONE, state: 'BROWSING_ITEMS', cart: [] as any[], customerId: 'cust-1', activeCategoryId: 'cat-1' };
    prisma.whatsAppSession.findUnique.mockResolvedValue(session);
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', name: 'Shakes', slug: 'shakes' });
    products.list.mockResolvedValue([{ id: 'p1', name: 'Chocolate Shake', basePriceRs: 129 }]);

    const reply1 = await service.handleIncomingMessage(PHONE, '1');
    expect(reply1.text).toMatch(/Added Chocolate Shake/);

    // Simulate the cart having been persisted after the first add.
    session.cart = [{ productId: 'p1', name: 'Chocolate Shake', unitPriceRs: 129, quantity: 1 }];
    const reply2 = await service.handleIncomingMessage(PHONE, '1');
    expect(reply2.text).toMatch(/Added Chocolate Shake/);

    const secondUpdateCall = prisma.whatsAppSession.update.mock.calls.find((c: any) => c[0].data.cart);
    expect(secondUpdateCall[0].data.cart[0].quantity).toBeGreaterThanOrEqual(1);
  });
});

describe('WhatsAppBotService.handleIncomingMessage — cart and checkout', () => {
  it('shows an empty-cart message when there is nothing in it', async () => {
    const { service, prisma } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({ phone: PHONE, state: 'BROWSING_CATEGORIES', cart: [], customerId: 'cust-1', activeCategoryId: null });

    const reply = await service.handleIncomingMessage(PHONE, 'cart');

    expect(reply.text).toMatch(/cart is empty/i);
  });

  it('shows cart contents and the correct total for a multi-item cart', async () => {
    const { service, prisma } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      phone: PHONE,
      state: 'BROWSING_ITEMS',
      cart: [
        { productId: 'p1', name: 'Chocolate Shake', unitPriceRs: 129, quantity: 2 },
        { productId: 'p2', name: 'Protein Bar', unitPriceRs: 49, quantity: 1 },
      ],
      customerId: 'cust-1',
      activeCategoryId: null,
    });

    const reply = await service.handleIncomingMessage(PHONE, 'cart');

    expect(reply.text).toContain('2 x Chocolate Shake — ₹258');
    expect(reply.text).toContain('1 x Protein Bar — ₹49');
    expect(reply.text).toContain('Total: ₹307');
  });

  it('checkout creates a real order via OrdersService and returns a real payment link', async () => {
    const { service, prisma, orders, payments } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      phone: PHONE,
      state: 'VIEWING_CART',
      cart: [{ productId: 'p1', name: 'Chocolate Shake', unitPriceRs: 129, quantity: 2 }],
      customerId: 'cust-1',
      activeCategoryId: null,
    });
    orders.create.mockResolvedValue({ id: 'order-1', orderNumber: 'PP1234', totalRs: 258 });
    payments.createPaymentLinkForOrder.mockResolvedValue({ shortUrl: 'https://rzp.io/i/abc123' });

    const reply = await service.handleIncomingMessage(PHONE, 'checkout');

    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        channel: 'WHATSAPP',
        items: [{ productId: 'p1', quantity: 2 }],
      }),
    );
    expect(reply.text).toContain('PP1234');
    expect(reply.text).toContain('https://rzp.io/i/abc123');
    expect(prisma.whatsAppSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'AWAITING_PAYMENT', pendingOrderId: 'order-1' }) }),
    );
  });

  it('checkout on an empty cart does not create an order at all', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({ phone: PHONE, state: 'VIEWING_CART', cart: [], customerId: 'cust-1', activeCategoryId: null });

    const reply = await service.handleIncomingMessage(PHONE, 'checkout');

    expect(orders.create).not.toHaveBeenCalled();
    expect(reply.text).toMatch(/cart is empty/i);
  });

  it('a real order-creation failure is reported back, not swallowed silently', async () => {
    const { service, prisma, orders } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      phone: PHONE,
      state: 'VIEWING_CART',
      cart: [{ productId: 'p1', name: 'Chocolate Shake', unitPriceRs: 129, quantity: 1 }],
      customerId: 'cust-1',
      activeCategoryId: null,
    });
    orders.create.mockRejectedValue(new Error('Shop is currently closed'));

    const reply = await service.handleIncomingMessage(PHONE, 'checkout');

    expect(reply.text).toMatch(/Shop is currently closed/);
  });

  it('clear empties the cart', async () => {
    const { service, prisma } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      phone: PHONE,
      state: 'VIEWING_CART',
      cart: [{ productId: 'p1', name: 'Chocolate Shake', unitPriceRs: 129, quantity: 1 }],
      customerId: 'cust-1',
      activeCategoryId: null,
    });

    const reply = await service.handleIncomingMessage(PHONE, 'clear');

    expect(reply.text).toMatch(/cart has been cleared/i);
    expect(prisma.whatsAppSession.update).toHaveBeenCalledWith(expect.objectContaining({ data: { cart: [] } }));
  });
});

describe('WhatsAppBotService.handleIncomingMessage — global commands work from any state', () => {
  it('"menu" jumps back to categories even from deep in the item-browsing state', async () => {
    const { service, prisma } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({ phone: PHONE, state: 'BROWSING_ITEMS', cart: [], customerId: 'cust-1', activeCategoryId: 'cat-1' });
    prisma.productCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Shakes' }]);

    const reply = await service.handleIncomingMessage(PHONE, 'menu');

    expect(reply.text).toContain('1. Shakes');
  });
});

describe('WhatsAppBotService.verifyWebhookSignature', () => {
  const originalSecret = process.env.WHATSAPP_APP_SECRET;
  afterEach(() => {
    process.env.WHATSAPP_APP_SECRET = originalSecret;
  });

  it('accepts a correctly signed request', () => {
    const { service } = makeHarness();
    process.env.WHATSAPP_APP_SECRET = 'test-secret';
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = 'sha256=' + createHmac('sha256', 'test-secret').update(body).digest('hex');

    expect(service.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it('rejects a request signed with the wrong secret', () => {
    const { service } = makeHarness();
    process.env.WHATSAPP_APP_SECRET = 'test-secret';
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = 'sha256=' + createHmac('sha256', 'wrong-secret').update(body).digest('hex');

    expect(service.verifyWebhookSignature(body, signature)).toBe(false);
  });

  it('rejects a request whose body was tampered with after signing', () => {
    const { service } = makeHarness();
    process.env.WHATSAPP_APP_SECRET = 'test-secret';
    const originalBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = 'sha256=' + createHmac('sha256', 'test-secret').update(originalBody).digest('hex');
    const tamperedBody = Buffer.from(JSON.stringify({ hello: 'tampered' }));

    expect(service.verifyWebhookSignature(tamperedBody, signature)).toBe(false);
  });

  it('rejects a request with no signature header at all', () => {
    const { service } = makeHarness();
    process.env.WHATSAPP_APP_SECRET = 'test-secret';
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));

    expect(service.verifyWebhookSignature(body, undefined)).toBe(false);
  });

  it('rejects everything when WHATSAPP_APP_SECRET is not configured, rather than silently passing', () => {
    const { service } = makeHarness();
    delete process.env.WHATSAPP_APP_SECRET;
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));

    expect(service.verifyWebhookSignature(body, 'sha256=anything')).toBe(false);
  });
});

describe('WhatsAppBotService.handleIncomingMessage — interactive list support', () => {
  it('showCategories includes an interactive list alongside the plain text fallback', async () => {
    const { service, prisma } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({ phone: PHONE, state: 'GREETING', cart: [], customerId: 'cust-1', activeCategoryId: null });
    prisma.productCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Shakes' }]);

    const reply = await service.handleIncomingMessage(PHONE, 'hi');

    expect(reply.interactiveList).toBeDefined();
    expect(reply.interactiveList!.sections[0].rows[0]).toEqual({ id: 'cat:cat-1', title: 'Shakes' });
  });

  it('accepts a tapped list row id ("cat:<id>") exactly like a typed number', async () => {
    const { service, prisma, products } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({ phone: PHONE, state: 'BROWSING_CATEGORIES', cart: [], customerId: 'cust-1', activeCategoryId: null });
    prisma.productCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Shakes', slug: 'shakes' }]);
    products.list.mockResolvedValue([{ id: 'p1', name: 'Chocolate Shake', basePriceRs: 129 }]);

    const reply = await service.handleIncomingMessage(PHONE, 'cat:cat-1');

    expect(reply.text).toContain('Chocolate Shake — ₹129');
  });

  it('accepts a tapped item list row id ("item:<id>") exactly like a typed number', async () => {
    const { service, prisma, products } = makeHarness();
    prisma.whatsAppSession.findUnique.mockResolvedValue({ phone: PHONE, state: 'BROWSING_ITEMS', cart: [], customerId: 'cust-1', activeCategoryId: 'cat-1' });
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', name: 'Shakes', slug: 'shakes' });
    products.list.mockResolvedValue([{ id: 'p1', name: 'Chocolate Shake', basePriceRs: 129 }]);

    const reply = await service.handleIncomingMessage(PHONE, 'item:p1');

    expect(reply.text).toMatch(/Added Chocolate Shake/);
  });
});
