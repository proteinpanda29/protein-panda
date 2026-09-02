import { WhatsAppNotificationProcessor } from './whatsapp-notification.processor';

describe('WhatsAppNotificationProcessor.process', () => {
  it('sends the template with the phone and variables from the job payload', async () => {
    const whatsapp = { sendTemplate: jest.fn().mockResolvedValue(true) } as any;
    const processor = new WhatsAppNotificationProcessor(whatsapp);

    await processor.process({ data: { phone: '+919876543210', templateName: 'order_confirmed', variables: ['PP1234'] }, attemptsMade: 0 } as any);

    expect(whatsapp.sendTemplate).toHaveBeenCalledWith('+919876543210', 'order_confirmed', ['PP1234']);
  });

  it('throws when the send fails, so BullMQ actually retries — swallowing it here would silently defeat the retry policy', async () => {
    const whatsapp = { sendTemplate: jest.fn().mockResolvedValue(false) } as any;
    const processor = new WhatsAppNotificationProcessor(whatsapp);

    await expect(
      processor.process({ data: { phone: '+919876543210', templateName: 'order_confirmed', variables: [] }, attemptsMade: 0 } as any),
    ).rejects.toThrow();
  });
});
