import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';

interface CartLine {
  productId: string;
  name: string;
  unitPriceRs: number;
  quantity: number;
}

export interface BotReply {
  text: string;
  interactiveList?: {
    bodyText: string;
    buttonText: string;
    sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
  };
}

/**
 * The whole point of this bot: reuse the exact same menu, order
 * creation, and payment logic every other channel (website, POS)
 * already goes through — never a second, parallel implementation of
 * "what's on the menu" or "how a payment gets collected." This class
 * only adds what's genuinely new: turning a WhatsApp message into a
 * conversation step, and remembering where each phone number is
 * between messages.
 */
@Injectable()
export class WhatsAppBotService {
  private logger = new Logger('WhatsAppBotService');

  constructor(
    private prisma: PrismaService,
    private products: ProductsService,
    private orders: OrdersService,
    private payments: PaymentsService,
  ) {}

  /**
   * Verifies Meta's X-Hub-Signature-256 header — HMAC-SHA256 of the
   * raw request body using WHATSAPP_APP_SECRET, in Meta's documented
   * "sha256=<hex>" format. Without this, anyone who discovers this
   * webhook's URL could POST fake customer messages (create real
   * orders, trigger real payment links) with no way to tell they
   * didn't come from Meta at all. timingSafeEqual (not plain string
   * equality) specifically to avoid a timing side-channel revealing
   * the correct signature one byte at a time — the same reasoning
   * that applies to comparing any secret, even though the existing
   * Razorpay webhook check in this codebase uses plain equality.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret || !signatureHeader) return false;

    const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signatureHeader);
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private async findOrCreateCustomerByPhone(phone: string): Promise<string> {
    const existingUser = await this.prisma.user.findUnique({ where: { phone }, include: { customer: true } });
    if (existingUser?.customer) return existingUser.customer.id;

    // A brand new WhatsApp number with no account yet — created the
    // same way a POS walk-in customer is, so ordering via WhatsApp
    // never requires signing up on the website first.
    const user = await this.prisma.user.create({
      data: { role: 'CUSTOMER', phone, customer: { create: { name: 'WhatsApp Customer' } } },
      include: { customer: true },
    });
    return user.customer!.id;
  }

  private async getOrCreateSession(phone: string) {
    const existing = await this.prisma.whatsAppSession.findUnique({ where: { phone } });
    if (existing) return existing;
    return this.prisma.whatsAppSession.create({ data: { phone, customerId: await this.findOrCreateCustomerByPhone(phone) } });
  }

  private getCart(session: { cart: unknown }): CartLine[] {
    return Array.isArray(session.cart) ? (session.cart as unknown as CartLine[]) : [];
  }

  private cartTotal(cart: CartLine[]): number {
    return cart.reduce((sum, line) => sum + line.unitPriceRs * line.quantity, 0);
  }

  /**
   * The single entry point the webhook controller calls for every
   * inbound message. Always returns a BotReply — the controller's
   * only job is delivering it (as an interactive list when present,
   * plain text otherwise), never deciding what it contains.
   *
   * `text` also accepts a structured selection id from a tapped list
   * row (e.g. "cat:<uuid>", "item:<uuid>") alongside a typed number,
   * so the exact same handlers work whether the customer tapped a
   * list row or typed a digit as a fallback.
   */
  async handleIncomingMessage(phone: string, rawText: string): Promise<BotReply> {
    const text = rawText.trim();
    const lower = text.toLowerCase();
    let session = await this.getOrCreateSession(phone);

    // Global commands that work from any state — a customer typing
    // "menu" or "cart" shouldn't have to first escape whatever step
    // they're stuck on.
    if (lower === 'menu' || lower === 'hi' || lower === 'hello' || lower === 'start') {
      return this.showCategories(session.phone);
    }
    if (lower === 'cart') {
      return this.showCart(session);
    }

    switch (session.state) {
      case 'GREETING':
        return this.showCategories(session.phone);

      case 'BROWSING_CATEGORIES':
        return this.handleCategorySelection(session, text);

      case 'BROWSING_ITEMS':
        return this.handleItemSelection(session, text);

      case 'VIEWING_CART':
        return this.handleCartCommand(session, lower);

      case 'AWAITING_PAYMENT':
        return { text: "Your order is waiting on payment — use the link already sent, or reply 'menu' to start a new order." };

      default:
        return this.showCategories(session.phone);
    }
  }

  private async showCategories(phone: string): Promise<BotReply> {
    const categories = await this.prisma.productCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, take: 10 });
    await this.prisma.whatsAppSession.update({ where: { phone }, data: { state: 'BROWSING_CATEGORIES', activeCategoryId: null } });

    if (categories.length === 0) return { text: 'Sorry, the menu is empty right now — please try again later.' };

    return {
      text: `🐼 Welcome to Protein Panda! What would you like to order?\n\n${categories.map((c: { name: string }, i: number) => `${i + 1}. ${c.name}`).join('\n')}\n\nReply with a number to browse that category.`,
      interactiveList: {
        bodyText: '🐼 Welcome to Protein Panda! What would you like to order?',
        buttonText: 'Choose Category',
        sections: [{ title: 'Categories', rows: categories.map((c: { id: string; name: string }) => ({ id: `cat:${c.id}`, title: c.name })) }],
      },
    };
  }

  private async handleCategorySelection(session: { phone: string }, text: string): Promise<BotReply> {
    const categories = await this.prisma.productCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, take: 10 });

    // A tapped list row arrives as "cat:<id>"; a typed fallback arrives
    // as a plain number — both are supported since not every WhatsApp
    // client version renders interactive lists identically.
    let category = text.startsWith('cat:')
      ? categories.find((c: { id: string }) => c.id === text.slice(4))
      : categories[parseInt(text, 10) - 1];

    if (!category) {
      return { text: "Sorry, I didn't recognize that — reply with one of the numbers shown, or 'menu' to see the categories again." };
    }

    const products = await this.products.list({ categorySlug: category.slug, take: 10 });
    if (products.length === 0) {
      return { text: `No items in ${category.name} right now — reply 'menu' to pick a different category.` };
    }

    await this.prisma.whatsAppSession.update({ where: { phone: session.phone }, data: { state: 'BROWSING_ITEMS', activeCategoryId: category.id } });

    return {
      text: `${category.name}:\n\n${products.map((p: { name: string; basePriceRs: unknown }, i: number) => `${i + 1}. ${p.name} — ₹${p.basePriceRs}`).join('\n')}\n\nReply with a number to add an item, 'cart' to view your cart, or 'menu' to go back.`,
      interactiveList: {
        bodyText: `${category.name} — tap an item to add it to your cart`,
        buttonText: 'Choose Item',
        sections: [{
          title: category.name,
          rows: products.map((p: { id: string; name: string; basePriceRs: unknown }) => ({ id: `item:${p.id}`, title: p.name, description: `₹${p.basePriceRs}` })),
        }],
      },
    };
  }

  private async handleItemSelection(session: { phone: string; activeCategoryId: string | null; cart: unknown }, text: string): Promise<BotReply> {
    if (!session.activeCategoryId) return this.showCategories(session.phone);

    const category = await this.prisma.productCategory.findUnique({ where: { id: session.activeCategoryId } });
    if (!category) return this.showCategories(session.phone);

    const products = await this.products.list({ categorySlug: category.slug, take: 10 });
    let product = text.startsWith('item:')
      ? products.find((p: { id: string }) => p.id === text.slice(5))
      : products[parseInt(text, 10) - 1];

    if (!product) {
      return { text: "Sorry, I didn't recognize that — reply with one of the numbers shown, 'cart', or 'menu'." };
    }

    const cart = this.getCart(session);
    const existingLine = cart.find((l) => l.productId === product.id);
    if (existingLine) {
      existingLine.quantity += 1;
    } else {
      cart.push({ productId: product.id, name: product.name, unitPriceRs: Number(product.basePriceRs), quantity: 1 });
    }

    await this.prisma.whatsAppSession.update({ where: { phone: session.phone }, data: { cart: cart as any } });

    return { text: `Added ${product.name} to your cart. ✅\n\nReply with another number to add more, 'cart' to view your cart, or 'menu' to browse other categories.` };
  }

  private async showCart(session: { phone: string; cart: unknown }): Promise<BotReply> {
    const cart = this.getCart(session);
    await this.prisma.whatsAppSession.update({ where: { phone: session.phone }, data: { state: 'VIEWING_CART' } });

    if (cart.length === 0) {
      return { text: "Your cart is empty. Reply 'menu' to start browsing." };
    }

    const lines = cart.map((l) => `${l.quantity} x ${l.name} — ₹${l.unitPriceRs * l.quantity}`);
    const total = this.cartTotal(cart);
    return { text: `🛒 Your Cart:\n\n${lines.join('\n')}\n\nTotal: ₹${total}\n\nReply 'checkout' to pay, 'menu' to add more items, or 'clear' to empty your cart.` };
  }

  private async handleCartCommand(session: { phone: string; customerId: string | null; cart: unknown }, lower: string): Promise<BotReply> {
    if (lower === 'clear') {
      await this.prisma.whatsAppSession.update({ where: { phone: session.phone }, data: { cart: [] as any } });
      return { text: "Your cart has been cleared. Reply 'menu' to start browsing again." };
    }

    if (lower === 'checkout') {
      return this.checkout(session);
    }

    return this.showCart(session);
  }

  private async checkout(session: { phone: string; customerId: string | null; cart: unknown }): Promise<BotReply> {
    const cart = this.getCart(session);
    if (cart.length === 0) {
      return { text: "Your cart is empty — reply 'menu' to add something first." };
    }
    if (!session.customerId) {
      return { text: 'Something went wrong identifying your account — please try messaging "menu" again.' };
    }

    try {
      // The exact same order-creation path the website and POS already
      // use — a WhatsApp order is a real order the moment this runs,
      // not a separate, bot-only record.
      const order = await this.orders.create({
        customerId: session.customerId,
        channel: 'WHATSAPP',
        fulfillmentType: 'PICKUP',
        paymentMethod: 'UPI',
        items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      });

      const paymentLink = await this.payments.createPaymentLinkForOrder(order.id);

      await this.prisma.whatsAppSession.update({
        where: { phone: session.phone },
        data: { state: 'AWAITING_PAYMENT', pendingOrderId: order.id, cart: [] as any },
      });

      return { text: `Order #${order.orderNumber} created! 🎉\n\nTotal: ₹${order.totalRs}\n\nPay here to confirm: ${paymentLink.shortUrl}\n\nYou'll get a message here the moment payment is confirmed.` };
    } catch (err: any) {
      this.logger.error(`WhatsApp checkout failed for ${session.phone}: ${err.message}`);
      return { text: `Sorry, something went wrong creating your order: ${err.message}. Please try 'checkout' again, or contact us directly.` };
    }
  }
}
