import { NotificationQueueService } from './notification-queue.service';

function makeHarness() {
  const invoiceQueue = { add: jest.fn() } as any;
  const whatsappQueue = { add: jest.fn() } as any;
  const invoices = { sendInvoiceEmail: jest.fn().mockResolvedValue(undefined) } as any;
  const whatsapp = { sendTemplate: jest.fn().mockResolvedValue(true) } as any;
  const service = new NotificationQueueService(invoiceQueue, whatsappQueue, invoices, whatsapp);
  return { service, invoiceQueue, whatsappQueue, invoices, whatsapp };
}

describe('NotificationQueueService.queueInvoiceEmail', () => {
  it('enqueues a job with the order id and a retry policy', async () => {
    const { service, invoiceQueue } = makeHarness();
    invoiceQueue.add.mockResolvedValue({});

    await service.queueInvoiceEmail('order-1');

    expect(invoiceQueue.add).toHaveBeenCalledWith(
      'send',
      { orderId: 'order-1' },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('does not call InvoiceService directly when the queue accepts the job', async () => {
    const { service, invoiceQueue, invoices } = makeHarness();
    invoiceQueue.add.mockResolvedValue({});

    await service.queueInvoiceEmail('order-1');

    expect(invoices.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it('falls back to calling InvoiceService directly if the queue is unreachable — a missing queue must never mean a missing e-bill', async () => {
    const { service, invoiceQueue, invoices } = makeHarness();
    invoiceQueue.add.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

    await service.queueInvoiceEmail('order-1');

    expect(invoices.sendInvoiceEmail).toHaveBeenCalledWith('order-1');
  });

  it('never throws even if both the queue AND the direct fallback fail', async () => {
    const { service, invoiceQueue, invoices } = makeHarness();
    invoiceQueue.add.mockRejectedValue(new Error('redis down'));
    invoices.sendInvoiceEmail.mockRejectedValue(new Error('smtp down too'));

    await expect(service.queueInvoiceEmail('order-1')).resolves.toBeUndefined();
  });
});

describe('NotificationQueueService.queueWhatsAppNotification', () => {
  it('enqueues a job with the phone, template name, variables, and a retry policy', async () => {
    const { service, whatsappQueue } = makeHarness();
    whatsappQueue.add.mockResolvedValue({});

    await service.queueWhatsAppNotification('+919876543210', 'order_confirmed', ['PP1234']);

    expect(whatsappQueue.add).toHaveBeenCalledWith(
      'send',
      { phone: '+919876543210', templateName: 'order_confirmed', variables: ['PP1234'] },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('does not call WhatsAppService directly when the queue accepts the job', async () => {
    const { service, whatsappQueue, whatsapp } = makeHarness();
    whatsappQueue.add.mockResolvedValue({});

    await service.queueWhatsAppNotification('+919876543210', 'order_confirmed', ['PP1234']);

    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('falls back to calling WhatsAppService directly if the queue is unreachable', async () => {
    const { service, whatsappQueue, whatsapp } = makeHarness();
    whatsappQueue.add.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

    await service.queueWhatsAppNotification('+919876543210', 'order_confirmed', ['PP1234']);

    expect(whatsapp.sendTemplate).toHaveBeenCalledWith('+919876543210', 'order_confirmed', ['PP1234']);
  });

  it('never throws even if both the queue AND the direct fallback fail', async () => {
    const { service, whatsappQueue, whatsapp } = makeHarness();
    whatsappQueue.add.mockRejectedValue(new Error('redis down'));
    whatsapp.sendTemplate.mockRejectedValue(new Error('msg91 down too'));

    await expect(service.queueWhatsAppNotification('+919876543210', 'order_confirmed', ['PP1234'])).resolves.toBeUndefined();
  });
});
