import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PushNotificationService } from './push-notification.service';

@Injectable()
export class NotificationCenterService {
  constructor(
    private prisma: PrismaService,
    private push: PushNotificationService,
  ) {}

  async listForCustomer(customerId: string, take = 30) {
    return this.prisma.notification.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async unreadCount(customerId: string) {
    return this.prisma.notification.count({ where: { customerId, isRead: false } });
  }

  /**
   * Generic single-customer notification, for reuse by other modules
   * (support ticketing, and anything future) instead of each one making
   * its own raw prisma.notification.create call. Never throws — a
   * notification failing to persist should never break whatever real
   * action triggered it.
   *
   * Every call here now also fires a real push notification (if the
   * customer has a subscription and VAPID is configured) — deliberately
   * wired into this single shared entry point rather than added
   * separately at every call site (order confirmation, achievements,
   * support replies, announcements), so push automatically covers
   * everything the in-app notification center already covers, with no
   * risk of the two silently drifting apart over time.
   */
  async notifyCustomer(
    customerId: string,
    type: 'ORDER_UPDATE' | 'ACHIEVEMENT' | 'ANNOUNCEMENT' | 'SUPPORT_REPLY',
    title: string,
    body: string,
    // Optional — only ever set for the specific "out for delivery"
    // notification, which is the one moment a quick reply actually
    // matters. Every other call site (order confirmed, achievement
    // unlocked, etc.) omits these and gets a plain notification exactly
    // as before.
    pushExtras?: { actions?: { action: string; title: string }[]; data?: Record<string, unknown> },
  ) {
    try {
      await this.prisma.notification.create({ data: { customerId, type, title, body } });
    } catch {
      // Swallowed deliberately — see docstring above.
    }
    this.push.sendToCustomer(customerId, { title, body, ...pushExtras }).catch(() => undefined);
  }

  async markAsRead(customerId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });
    if (notification.customerId !== customerId) {
      throw new ForbiddenException('This notification does not belong to you');
    }
    return this.prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } });
  }

  async markAllAsRead(customerId: string) {
    return this.prisma.notification.updateMany({ where: { customerId, isRead: false }, data: { isRead: true } });
  }

  /**
   * Fans out one Notification row per active customer, so each gets
   * their own independent read/unread state — simpler and more robust
   * than a single shared "global" row plus a separate read-receipt join
   * table, and fine at the scale a single shop's customer base runs at.
   * Logs one AnnouncementLog row for the admin's own broadcast history,
   * distinct from the fan-out.
   */
  async broadcastAnnouncement(sentByUserId: string, title: string, body: string) {
    if (!title?.trim()) throw new BadRequestException('A title is required');
    if (!body?.trim()) throw new BadRequestException('A message body is required');

    const customers = await this.prisma.customer.findMany({
      where: { user: { isActive: true } },
      select: { id: true },
    });

    if (customers.length > 0) {
      await this.prisma.notification.createMany({
        data: customers.map((c: { id: string }) => ({
          customerId: c.id,
          type: 'ANNOUNCEMENT' as const,
          title: title.trim(),
          body: body.trim(),
        })),
      });
    }

    return this.prisma.announcementLog.create({
      data: { title: title.trim(), body: body.trim(), recipientCount: customers.length, sentByUserId },
    });
  }

  async listAnnouncementHistory(take = 30) {
    return this.prisma.announcementLog.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: { sentByUser: { select: { staff: { select: { name: true } } } } },
    });
  }
}
