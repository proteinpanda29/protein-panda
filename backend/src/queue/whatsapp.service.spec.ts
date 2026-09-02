import { WhatsAppService } from './whatsapp.service';

describe('WhatsAppService.isConfigured', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('is false when WHATSAPP_AUTH_KEY/WHATSAPP_INTEGRATED_NUMBER are missing', () => {
    process.env = { ...OLD_ENV };
    delete process.env.WHATSAPP_AUTH_KEY;
    delete process.env.WHATSAPP_INTEGRATED_NUMBER;
    const service = new WhatsAppService();

    expect(service.isConfigured()).toBe(false);
  });

  it('is true when both are set', () => {
    process.env = { ...OLD_ENV, WHATSAPP_AUTH_KEY: 'key', WHATSAPP_INTEGRATED_NUMBER: '919999999999' };
    const service = new WhatsAppService();

    expect(service.isConfigured()).toBe(true);
  });
});

describe('WhatsAppService.sendTemplate', () => {
  const OLD_ENV = process.env;
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    process.env = OLD_ENV;
    fetchSpy?.mockRestore();
  });

  it('returns false without attempting a request when not configured', async () => {
    process.env = { ...OLD_ENV };
    delete process.env.WHATSAPP_AUTH_KEY;
    delete process.env.WHATSAPP_INTEGRATED_NUMBER;
    fetchSpy = jest.spyOn(global, 'fetch' as any);
    const service = new WhatsAppService();

    const result = await service.sendTemplate('+919876543210', 'order_confirmed', ['PP1234']);

    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns false and logs rather than throwing when the provider responds with an error', async () => {
    process.env = { ...OLD_ENV, WHATSAPP_AUTH_KEY: 'key', WHATSAPP_INTEGRATED_NUMBER: '919999999999' };
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorised' } as any);
    const service = new WhatsAppService();

    const result = await service.sendTemplate('+919876543210', 'order_confirmed', ['PP1234']);

    expect(result).toBe(false);
  });

  it('never throws even if the network request itself fails', async () => {
    process.env = { ...OLD_ENV, WHATSAPP_AUTH_KEY: 'key', WHATSAPP_INTEGRATED_NUMBER: '919999999999' };
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('network down'));
    const service = new WhatsAppService();

    await expect(service.sendTemplate('+919876543210', 'order_confirmed', ['PP1234'])).resolves.toBe(false);
  });

  it('returns true when the provider accepts the request', async () => {
    process.env = { ...OLD_ENV, WHATSAPP_AUTH_KEY: 'key', WHATSAPP_INTEGRATED_NUMBER: '919999999999' };
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, text: async () => '' } as any);
    const service = new WhatsAppService();

    const result = await service.sendTemplate('+919876543210', 'order_confirmed', ['PP1234']);

    expect(result).toBe(true);
  });
});
