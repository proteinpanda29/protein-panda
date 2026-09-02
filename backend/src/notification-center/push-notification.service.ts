import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class PushNotificationService {
  private logger = new Logger('PushNotificationService');
  private configured = false;

  constructor(private prisma: PrismaService) {}

  isConfigured(): boolean {
    return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  }

  getPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  private ensureConfigured() {
    if (this.configured) return;
    if (!this.isConfigured()) return;
    webpush.setVapidDetails(
      process.env.VAPID_CONTACT_EMAIL ? `mailto:${process.env.VAPID_CONTACT_EMAIL}` : 'mailto:admin@example.com',
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    this.configured = true;
  }

  async subscribe(customerId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        customerId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      update: {
        customerId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
  }

  async unsubscribe(endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { unsubscribed: true };
  }

  /**
   * Sends to every device a customer has ever subscribed on — a
   * customer with the site open on both phone and laptop gets it on
   * both, which is the expected behavior for a push notification, not
   * a bug to dedupe away. A stale subscription (410 Gone — the
   * classic signal a browser reports when it's dropped a registration,
   * e.g. after being uninstalled) is cleaned up automatically rather
   * than left to fail silently forever on every future send.
   */
  async sendToCustomer(customerId: string, payload: { title: string; body: string; url?: string }): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.warn(`Push not sent (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not configured): "${payload.title}" to customer ${customerId}`);
      return;
    }
    this.ensureConfigured();

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { customerId } });
    if (subscriptions.length === 0) return;

    await Promise.all(
      subscriptions.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
          );
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          } else {
            this.logger.error(`Push send failed for subscription ${sub.id}: ${err?.message ?? err}`);
          }
        }
      }),
    );
  }
}
