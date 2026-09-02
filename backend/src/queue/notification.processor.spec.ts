import { NotificationProcessor } from './notification.processor';

describe('NotificationProcessor.process', () => {
  it('sends the invoice email for the order id in the job payload', async () => {
    const invoices = { sendInvoiceEmail: jest.fn().mockResolvedValue(undefined) } as any;
    const processor = new NotificationProcessor(invoices);

    await processor.process({ data: { orderId: 'order-1' }, attemptsMade: 0 } as any);

    expect(invoices.sendInvoiceEmail).toHaveBeenCalledWith('order-1');
  });

  it('lets a failure propagate so BullMQ actually retries — swallowing it here would silently defeat the whole point of queueing', async () => {
    const invoices = { sendInvoiceEmail: jest.fn().mockRejectedValue(new Error('smtp down')) } as any;
    const processor = new NotificationProcessor(invoices);

    await expect(processor.process({ data: { orderId: 'order-1' }, attemptsMade: 0 } as any)).rejects.toThrow('smtp down');
  });
});
