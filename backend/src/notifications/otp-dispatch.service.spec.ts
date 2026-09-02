import { OtpDispatchService } from './otp-dispatch.service';

function makePrisma(businessName = 'Protein Panda') {
  return { shopSettings: { findUnique: jest.fn().mockResolvedValue({ businessName } as any) } } as any;
}

function makeEmail(configured: boolean) {
  return {
    isConfigured: jest.fn().mockReturnValue(configured),
    send: jest.fn().mockResolvedValue(true),
  } as any;
}

describe('OtpDispatchService.sendOtp', () => {
  const OLD_ENV = process.env;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.MSG91_AUTH_KEY;
    delete process.env.MSG91_DLT_TEMPLATE_ID;
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, text: async () => '' } as any);
  });

  afterEach(() => {
    process.env = OLD_ENV;
    fetchSpy.mockRestore();
  });

  it('falls back to the dev warning log when no email provider is configured', async () => {
    const service = new OtpDispatchService(makePrisma(), makeEmail(false));
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await service.sendOtp('user@example.com', '123456');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('123456'));
  });

  it('falls back to the dev warning log when no SMS provider is configured for a phone identifier', async () => {
    const service = new OtpDispatchService(makePrisma(), makeEmail(false));
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await service.sendOtp('+919876543210', '654321');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('654321'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls the MSG91 API with the code when SMS credentials are configured', async () => {
    process.env.MSG91_AUTH_KEY = 'test-auth-key';
    process.env.MSG91_DLT_TEMPLATE_ID = 'test-template';
    const service = new OtpDispatchService(makePrisma(), makeEmail(false));

    await service.sendOtp('+919876543210', '111222');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://control.msg91.com/api/v5/flow',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authkey: 'test-auth-key' }),
      }),
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body.template_id).toBe('test-template');
    expect(body.recipients[0]).toEqual(expect.objectContaining({ OTP: '111222' }));
  });

  it('falls back to dev logging if the SMS provider call fails', async () => {
    process.env.MSG91_AUTH_KEY = 'test-auth-key';
    process.env.MSG91_DLT_TEMPLATE_ID = 'test-template';
    fetchSpy.mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid key' } as any);
    const service = new OtpDispatchService(makePrisma(), makeEmail(false));
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    await service.sendOtp('+919876543210', '999888');

    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('999888'));
  });

  it('never throws — a delivery failure must not break the login flow', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    process.env.MSG91_AUTH_KEY = 'k';
    process.env.MSG91_DLT_TEMPLATE_ID = 't';
    const service = new OtpDispatchService(makePrisma(), makeEmail(false));
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    await expect(service.sendOtp('+919876543210', '123123')).resolves.toBeUndefined();
  });

  it('falls back to dev logging if the configured email provider fails to actually send', async () => {
    const email = makeEmail(true);
    email.send.mockResolvedValue(false); // "configured" but the send itself failed
    const service = new OtpDispatchService(makePrisma(), email);
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await service.sendOtp('user@example.com', '333444');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('333444'));
  });
});

describe('OtpDispatchService.sendOtp — delegates to EmailService, not its own SMTP transport', () => {
  it('sends the OTP email from the configured business name, not a hardcoded one', async () => {
    const email = makeEmail(true);
    const service = new OtpDispatchService(makePrisma('Iron Fuel'), email);

    await service.sendOtp('customer@example.com', '482913');

    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        subject: expect.stringContaining('Iron Fuel'),
        fromName: 'Iron Fuel',
        html: expect.stringContaining('482913'),
      }),
    );
  });

  it('falls back to "Protein Panda" if shop settings have never been configured', async () => {
    const email = makeEmail(true);
    const prisma = { shopSettings: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const service = new OtpDispatchService(prisma, email);

    await service.sendOtp('customer@example.com', '111222');

    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ fromName: 'Protein Panda' }));
  });

  it('never touches nodemailer directly — that responsibility belongs entirely to EmailService now', async () => {
    const email = makeEmail(true);
    const service = new OtpDispatchService(makePrisma(), email);

    await service.sendOtp('customer@example.com', '555666');

    // The only real assertion that matters here: EmailService.send was
    // the thing called, not some parallel transport this class built
    // itself — which is exactly the duplication that caused ZeptoMail/
    // SendGrid/SES config to silently not apply to OTP emails before.
    expect(email.send).toHaveBeenCalledTimes(1);
  });
});
