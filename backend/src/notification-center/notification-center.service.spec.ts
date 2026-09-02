import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NotificationCenterService } from './notification-center.service';

function makeHarness() {
  const prisma: any = {
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      createMany: jest.fn(),
    },
    customer: { findMany: jest.fn() },
    announcementLog: { create: jest.fn(), findMany: jest.fn() },
  };
  const push = { sendToCustomer: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new NotificationCenterService(prisma, push);
  return { service, prisma, push };
}

describe('NotificationCenterService.markAsRead', () => {
  it('rejects marking a notification that does not belong to this customer', async () => {
    const { service, prisma } = makeHarness();
    prisma.notification.findUniqueOrThrow.mockResolvedValue({ id: 'n1', customerId: 'cust-OTHER' });

    await expect(service.markAsRead('cust-1', 'n1')).rejects.toThrow(ForbiddenException);
  });

  it('marks the notification read once ownership is confirmed', async () => {
    const { service, prisma } = makeHarness();
    prisma.notification.findUniqueOrThrow.mockResolvedValue({ id: 'n1', customerId: 'cust-1' });
    prisma.notification.update.mockResolvedValue({});

    await service.markAsRead('cust-1', 'n1');

    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { isRead: true } });
  });
});

describe('NotificationCenterService.markAllAsRead', () => {
  it("only updates this customer's unread notifications", async () => {
    const { service, prisma } = makeHarness();
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });

    await service.markAllAsRead('cust-1');

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', isRead: false },
      data: { isRead: true },
    });
  });
});

describe('NotificationCenterService.broadcastAnnouncement', () => {
  it('rejects a missing title', async () => {
    const { service } = makeHarness();
    await expect(service.broadcastAnnouncement('user-1', '', 'body text')).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing body', async () => {
    const { service } = makeHarness();
    await expect(service.broadcastAnnouncement('user-1', 'Title', '  ')).rejects.toThrow(/message body is required/);
  });

  it('only targets customers with an active account', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.announcementLog.create.mockResolvedValue({});

    await service.broadcastAnnouncement('user-1', 'Closed tomorrow', 'We are closed for maintenance.');

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user: { isActive: true } } }),
    );
  });

  it('creates one notification per active customer via fan-out', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findMany.mockResolvedValue([{ id: 'cust-1' }, { id: 'cust-2' }, { id: 'cust-3' }]);
    prisma.announcementLog.create.mockResolvedValue({});

    await service.broadcastAnnouncement('user-1', 'Closed tomorrow', 'We are closed for maintenance.');

    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        { customerId: 'cust-1', type: 'ANNOUNCEMENT', title: 'Closed tomorrow', body: 'We are closed for maintenance.' },
        { customerId: 'cust-2', type: 'ANNOUNCEMENT', title: 'Closed tomorrow', body: 'We are closed for maintenance.' },
        { customerId: 'cust-3', type: 'ANNOUNCEMENT', title: 'Closed tomorrow', body: 'We are closed for maintenance.' },
      ],
    });
  });

  it('skips the fan-out entirely when there are no active customers, but still logs the attempt', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.announcementLog.create.mockResolvedValue({});

    await service.broadcastAnnouncement('user-1', 'Title', 'Body');

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(prisma.announcementLog.create).toHaveBeenCalledWith({
      data: { title: 'Title', body: 'Body', recipientCount: 0, sentByUserId: 'user-1' },
    });
  });

  it('logs the correct recipient count alongside who sent it', async () => {
    const { service, prisma } = makeHarness();
    prisma.customer.findMany.mockResolvedValue([{ id: 'cust-1' }, { id: 'cust-2' }]);
    prisma.announcementLog.create.mockResolvedValue({});

    await service.broadcastAnnouncement('admin-user-1', 'Title', 'Body');

    expect(prisma.announcementLog.create).toHaveBeenCalledWith({
      data: { title: 'Title', body: 'Body', recipientCount: 2, sentByUserId: 'admin-user-1' },
    });
  });
});

describe('NotificationCenterService.notifyCustomer', () => {
  it('creates a notification with the given type/title/body', async () => {
    const { service, prisma } = makeHarness();
    prisma.notification.create = jest.fn().mockResolvedValue({});

    await service.notifyCustomer('cust-1', 'SUPPORT_REPLY', 'Reply to your ticket', 'We looked into this...');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: { customerId: 'cust-1', type: 'SUPPORT_REPLY', title: 'Reply to your ticket', body: 'We looked into this...' },
    });
  });

  it('never throws even if the write fails — callers should never break because logging a notification failed', async () => {
    const { service, prisma } = makeHarness();
    prisma.notification.create = jest.fn().mockRejectedValue(new Error('db down'));

    await expect(service.notifyCustomer('cust-1', 'ANNOUNCEMENT', 'Title', 'Body')).resolves.toBeUndefined();
  });

  it('also fires a real push notification — one shared entry point covers both the in-app inbox and push, so they cannot silently drift apart', async () => {
    const { service, prisma, push } = makeHarness();
    prisma.notification.create = jest.fn().mockResolvedValue({});

    await service.notifyCustomer('cust-1', 'ORDER_UPDATE', 'Order Confirmed', 'Your order #PP1234 has been confirmed.');

    expect(push.sendToCustomer).toHaveBeenCalledWith('cust-1', { title: 'Order Confirmed', body: 'Your order #PP1234 has been confirmed.' });
  });

  it('still fires the push even if the in-app notification write fails — the two channels are independent, one failing must not take down the other', async () => {
    const { service, prisma, push } = makeHarness();
    prisma.notification.create = jest.fn().mockRejectedValue(new Error('db down'));

    await service.notifyCustomer('cust-1', 'ORDER_UPDATE', 'Title', 'Body');

    expect(push.sendToCustomer).toHaveBeenCalled();
  });

  it('never throws even if the push send itself fails', async () => {
    const { service, prisma, push } = makeHarness();
    prisma.notification.create = jest.fn().mockResolvedValue({});
    push.sendToCustomer.mockRejectedValue(new Error('push service down'));

    await expect(service.notifyCustomer('cust-1', 'ORDER_UPDATE', 'Title', 'Body')).resolves.toBeUndefined();
  });
});
