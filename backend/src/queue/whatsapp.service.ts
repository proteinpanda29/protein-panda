import { Injectable, Logger } from '@nestjs/common';

/**
 * WhatsApp order-status notifications via MSG91's WhatsApp Business API.
 *
 * IMPORTANT — READ BEFORE USING: the exact request URL and payload shape
 * below are a best-effort placeholder, not verified against a real
 * MSG91 WhatsApp API response the way EmailService's ZeptoMail
 * integration was (that one was built from an exact confirmed example).
 * MSG91's public docs page for WhatsApp doesn't expose the actual
 * request schema outside their dashboard — once WHATSAPP_AUTH_KEY and
 * a real approved template exist, MSG91's dashboard will show a real
 * code example for that specific template. That example is what
 * sendTemplate() below needs to be corrected against before this is
 * trusted in production — treat isConfigured()/the queue
 * wiring/fallback behavior as done, and this one method as the
 * remaining real work.
 */
@Injectable()
export class WhatsAppService {
  private logger = new Logger('WhatsAppService');

  isConfigured(): boolean {
    return !!(process.env.WHATSAPP_AUTH_KEY && process.env.WHATSAPP_INTEGRATED_NUMBER);
  }

  /**
   * @param phone E.164-ish phone number, e.g. "+919876543210"
   * @param templateName The MSG91-registered, Meta-approved template name (e.g. "order_confirmed")
   * @param variables Ordered list of values to fill the template's placeholders, e.g. [orderNumber, trackingUrl]
   */
  async sendTemplate(phone: string, templateName: string, variables: string[]): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.warn(`WhatsApp not sent (WHATSAPP_AUTH_KEY/WHATSAPP_INTEGRATED_NUMBER not configured): template "${templateName}" to ${phone}`);
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      // PLACEHOLDER — see class-level note. Structured to mirror
      // MSG91's SMS "flow" API (already confirmed working elsewhere in
      // this app) as the most likely real shape, but has not been
      // verified against an actual MSG91 WhatsApp response.
      const response = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: process.env.WHATSAPP_AUTH_KEY! },
        body: JSON.stringify({
          integrated_number: process.env.WHATSAPP_INTEGRATED_NUMBER,
          content_type: 'template',
          payload: {
            messaging_product: 'whatsapp',
            type: 'template',
            template: {
              name: templateName,
              language: { code: 'en', policy: 'deterministic' },
              to_and_components: [
                {
                  to: [phone.replace(/[^\d]/g, '')],
                  components: {
                    body_1: variables.reduce((acc, v, i) => ({ ...acc, [`var${i + 1}`]: { value: v } }), {}),
                  },
                },
              ],
            },
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`MSG91 WhatsApp API responded ${response.status}: ${body}`);
      }
      return true;
    } catch (err) {
      this.logger.error(`Failed to send WhatsApp template "${templateName}" to ${phone}: ${(err as Error).message}`);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Free-form text — no pre-approved template needed, but Meta only
   * allows this within 24 hours of the customer's own last message
   * (the "customer service window"). This is what the conversational
   * bot actually replies with; sendTemplate() above remains for
   * business-initiated messages sent outside that window (order
   * confirmations, invoice shares), which are the only case Meta
   * requires a pre-approved template for at all.
   */
  async sendFreeformText(phone: string, text: string): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.warn(`WhatsApp not sent (WHATSAPP_AUTH_KEY/WHATSAPP_INTEGRATED_NUMBER not configured): text to ${phone}`);
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      // Same PLACEHOLDER caveat as sendTemplate() above — structured to
      // mirror MSG91's likely shape for a plain-text send, not yet
      // verified against a real MSG91 response.
      const response = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: process.env.WHATSAPP_AUTH_KEY! },
        body: JSON.stringify({
          integrated_number: process.env.WHATSAPP_INTEGRATED_NUMBER,
          content_type: 'text',
          payload: {
            messaging_product: 'whatsapp',
            type: 'text',
            text: { body: text },
            to: phone.replace(/[^\d]/g, ''),
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`MSG91 WhatsApp API responded ${response.status}: ${body}`);
      }
      return true;
    } catch (err) {
      this.logger.error(`Failed to send WhatsApp text to ${phone}: ${(err as Error).message}`);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * A tappable list — genuinely better UX than "reply with a number,"
   * and Meta's Cloud API supports it natively. Meta caps a single list
   * at 10 rows across all its sections combined; callers are
   * responsible for keeping within that (the bot only ever sends up
   * to 10 categories/items at a time for exactly this reason).
   *
   * PLACEHOLDER CAVEAT: same as sendTemplate/sendFreeformText above —
   * this payload shape is structured to match Meta's own documented
   * interactive-list format, since MSG91 is expected to pass Cloud
   * API payloads through largely as-is, but hasn't been verified
   * against a real MSG91 response yet.
   */
  async sendInteractiveList(
    phone: string,
    bodyText: string,
    buttonText: string,
    sections: { title: string; rows: { id: string; title: string; description?: string }[] }[],
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.warn(`WhatsApp not sent (WHATSAPP_AUTH_KEY/WHATSAPP_INTEGRATED_NUMBER not configured): interactive list to ${phone}`);
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: process.env.WHATSAPP_AUTH_KEY! },
        body: JSON.stringify({
          integrated_number: process.env.WHATSAPP_INTEGRATED_NUMBER,
          content_type: 'interactive',
          payload: {
            messaging_product: 'whatsapp',
            type: 'interactive',
            to: phone.replace(/[^\d]/g, ''),
            interactive: {
              type: 'list',
              body: { text: bodyText },
              action: {
                button: buttonText,
                sections: sections.map((s) => ({
                  title: s.title,
                  rows: s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
                })),
              },
            },
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`MSG91 WhatsApp API responded ${response.status}: ${body}`);
      }
      return true;
    } catch (err) {
      this.logger.error(`Failed to send WhatsApp interactive list to ${phone}: ${(err as Error).message}`);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
