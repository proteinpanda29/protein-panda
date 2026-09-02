import { PushNotificationService } from './push-notification.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

function makePrisma() {
  return {
    pushSubscription: {
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'sub-1', ...create })),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

describe('PushNotificationService.isConfigured / getPublicKey', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('is false when VAPID keys are not set', () => {
    process.env = { ...OLD_ENV };
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const service = new PushNotificationService(makePrisma());

    expect(service.isConfigured()).toBe(false);
    expect(service.getPublicKey()).toBeNull();
  });

  it('is true and returns the real public key once both are set', () => {
    process.env = { ...OLD_ENV, VAPID_PUBLIC_KEY: 'pub-key', VAPID_PRIVATE_KEY: 'priv-key' };
    const service = new PushNotificationService(makePrisma());

    expect(service.isConfigured()).toBe(true);
    expect(service.getPublicKey()).toBe('pub-key');
  });
});

describe('PushNotificationService.subscribe', () => {
  it('upserts on endpoint — a browser re-subscribing must update the existing row, not create a duplicate', async () => {
    const prisma = makePrisma();
    const service = new PushNotificationService(prisma);

    await service.subscribe('cust-1', { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p-key', auth: 'a-key' } });

    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example.com/abc' },
      create: { customerId: 'cust-1', endpoint: 'https://push.example.com/abc', p256dh: 'p-key', auth: 'a-key' },
      update: { customerId: 'cust-1', p256dh: 'p-key', auth: 'a-key' },
    });
  });
});

describe('PushNotificationService.unsubscribe', () => {
  it('removes the subscription matching the given endpoint', async () => {
    const prisma = makePrisma();
    const service = new PushNotificationService(prisma);

    const result = await service.unsubscribe('https://push.example.com/abc');

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { endpoint: 'https://push.example.com/abc' } });
    expect(result).toEqual({ unsubscribed: true });
  });
});

describe('PushNotificationService.sendToCustomer', () => {
  const OLD_ENV = process.env;
  const webpush = require('web-push');

  beforeEach(() => {
    process.env = { ...OLD_ENV, VAPID_PUBLIC_KEY: 'pub-key', VAPID_PRIVATE_KEY: 'priv-key' };
    webpush.sendNotification.mockReset();
    webpush.setVapidDetails.mockReset();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('does nothing (no error) when not configured at all', async () => {
    process.env = { ...OLD_ENV };
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const prisma = makePrisma();
    const service = new PushNotificationService(prisma);

    await expect(service.sendToCustomer('cust-1', { title: 'Hi', body: 'There' })).resolves.toBeUndefined();
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  it('does nothing when the customer has no subscriptions at all', async () => {
    const prisma = makePrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([]);
    const service = new PushNotificationService(prisma);

    await service.sendToCustomer('cust-1', { title: 'Hi', body: 'There' });

    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('sends to every subscribed device — a customer on both phone and laptop gets both, not deduplicated to one', async () => {
    const prisma = makePrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([
      { id: 'sub-1', endpoint: 'https://push.example.com/a', p256dh: 'p1', auth: 'a1' },
      { id: 'sub-2', endpoint: 'https://push.example.com/b', p256dh: 'p2', auth: 'a2' },
    ]);
    webpush.sendNotification.mockResolvedValue(undefined);
    const service = new PushNotificationService(prisma);

    await service.sendToCustomer('cust-1', { title: 'Hi', body: 'There' });

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('automatically removes a subscription that the push service reports as gone (410)', async () => {
    const prisma = makePrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([{ id: 'sub-1', endpoint: 'https://push.example.com/a', p256dh: 'p1', auth: 'a1' }]);
    webpush.sendNotification.mockRejectedValue({ statusCode: 410 });
    const service = new PushNotificationService(prisma);

    await service.sendToCustomer('cust-1', { title: 'Hi', body: 'There' });

    expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 'sub-1' } });
  });

  it('does not delete the subscription for a transient failure that is not a 404/410', async () => {
    const prisma = makePrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([{ id: 'sub-1', endpoint: 'https://push.example.com/a', p256dh: 'p1', auth: 'a1' }]);
    webpush.sendNotification.mockRejectedValue({ statusCode: 500 });
    const service = new PushNotificationService(prisma);

    await service.sendToCustomer('cust-1', { title: 'Hi', body: 'There' });

    expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
  });

  it('never throws even if sending fails entirely', async () => {
    const prisma = makePrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([{ id: 'sub-1', endpoint: 'https://push.example.com/a', p256dh: 'p1', auth: 'a1' }]);
    webpush.sendNotification.mockRejectedValue(new Error('network down'));
    const service = new PushNotificationService(prisma);

    await expect(service.sendToCustomer('cust-1', { title: 'Hi', body: 'There' })).resolves.toBeUndefined();
  });
});
