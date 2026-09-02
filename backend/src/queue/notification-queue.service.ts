import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { INVOICE_EMAIL_QUEUE, WHATSAPP_NOTIFICATION_QUEUE } from './queue.constants';
import { InvoiceService } from '../billing/invoice.service';
import { WhatsAppService } from './whatsapp.service';

@Injectable()
export class NotificationQueueService {
  private logger = new Logger('NotificationQueueService');

  constructor(
    @InjectQueue(INVOICE_EMAIL_QUEUE) private invoiceEmailQueue: Queue,
    @InjectQueue(WHATSAPP_NOTIFICATION_QUEUE) private whatsappQueue: Queue,
    private invoices: InvoiceService,
    private whatsapp: WhatsAppService,
  ) {}

  /**
   * Sending the e-bill email used to happen inline in the request that
   * created the order — fire-and-forget, so it never blocked the
   * response, but with no retry if it failed and nothing surviving a
   * server restart mid-send. Queueing it gives real retries (3 attempts,
   * backing off) and durability, without changing anything about how
   * order creation itself behaves — this is still called
   * fire-and-forget, same as before.
   *
   * If the queue itself can't be reached (Redis down/misconfigured),
   * this falls back to the exact old behavior — call InvoiceService
   * directly — rather than silently losing the email. A missing queue
   * should never mean a missing e-bill.
   */
  async queueInvoiceEmail(orderId: string): Promise<void> {
    try {
      await this.invoiceEmailQueue.add(
        'send',
        { orderId },
        { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
      );
    } catch (err) {
      this.logger.warn(
        `Could not enqueue invoice email for order ${orderId} (Redis unavailable?) — sending directly instead: ${(err as Error).message}`,
      );
      await this.invoices.sendInvoiceEmail(orderId).catch(() => undefined);
    }
  }

  /**
   * Same reasoning as queueInvoiceEmail — a WhatsApp send should never
   * block whatever triggered it, and should retry a transient provider
   * failure rather than silently drop the notification. If the queue
   * itself is unreachable, falls back to a direct (still async,
   * fire-and-forget-by-the-caller) call rather than losing the message.
   * A no-op if WhatsAppService isn't configured — see that class for
   * what's still needed there.
   */
  async queueWhatsAppNotification(phone: string, templateName: string, variables: string[]): Promise<void> {
    try {
      await this.whatsappQueue.add(
        'send',
        { phone, templateName, variables },
        { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
      );
    } catch (err) {
      this.logger.warn(
        `Could not enqueue WhatsApp notification to ${phone} (Redis unavailable?) — sending directly instead: ${(err as Error).message}`,
      );
      await this.whatsapp.sendTemplate(phone, templateName, variables).catch(() => undefined);
    }
  }
}
