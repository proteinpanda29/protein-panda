import { EmailService } from './email.service';

describe('EmailService.isConfigured', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('is false when GMAIL_USER/GMAIL_APP_PASSWORD are missing', () => {
    process.env = { ...OLD_ENV };
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    const service = new EmailService();

    expect(service.isConfigured()).toBe(false);
  });

  it('is true when both are set', () => {
    process.env = { ...OLD_ENV, GMAIL_USER: 'shop@example.com', GMAIL_APP_PASSWORD: 'pass' };
    const service = new EmailService();

    expect(service.isConfigured()).toBe(true);
  });

  it('is true when generic SMTP_HOST/SMTP_USER/SMTP_PASS are set instead — e.g. Zoho ZeptoMail, SendGrid, SES', () => {
    process.env = { ...OLD_ENV, SMTP_HOST: 'smtp.zeptomail.com', SMTP_USER: 'emailapikey', SMTP_PASS: 'secret' };
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    const service = new EmailService();

    expect(service.isConfigured()).toBe(true);
  });

  it('is false when only SMTP_HOST is set without the credentials — a partial config should not be treated as ready', () => {
    process.env = { ...OLD_ENV, SMTP_HOST: 'smtp.zeptomail.com' };
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    const service = new EmailService();

    expect(service.isConfigured()).toBe(false);
  });

  it('is true when ZEPTOMAIL_API_TOKEN/ZEPTOMAIL_FROM_EMAIL are set — the HTTPS API path, not SMTP', () => {
    process.env = { ...OLD_ENV, ZEPTOMAIL_API_TOKEN: 'token', ZEPTOMAIL_FROM_EMAIL: 'shop@proteinpanda.shop' };
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    delete process.env.SMTP_HOST;
    const service = new EmailService();

    expect(service.isConfigured()).toBe(true);
  });
});

describe('EmailService.send', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('returns false without sending when not configured', async () => {
    process.env = { ...OLD_ENV };
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    const service = new EmailService();

    const result = await service.send({ to: 'x@example.com', subject: 'Hi', html: '<p>hi</p>' });

    expect(result).toBe(false);
  });

  it('uses the default "Protein Panda" sender name when no fromName is given', async () => {
    process.env = { ...OLD_ENV, GMAIL_USER: 'shop@example.com', GMAIL_APP_PASSWORD: 'pass' };
    const sendMail = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({ sendMail } as any);
    const service = new EmailService();

    await service.send({ to: 'x@example.com', subject: 'Hi', html: '<p>hi</p>' });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: expect.stringContaining('Protein Panda') }));
  });

  it('configures a generic SMTP provider (e.g. Zoho ZeptoMail) with the correct host, port, and secure flag', async () => {
    process.env = { ...OLD_ENV, SMTP_HOST: 'smtp.zeptomail.com', SMTP_PORT: '465', SMTP_USER: 'emailapikey', SMTP_PASS: 'secret' };
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    const createTransport = jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({ sendMail: jest.fn().mockResolvedValue(undefined) } as any);
    const service = new EmailService();

    await service.send({ to: 'x@example.com', subject: 'Hi', html: '<p>hi</p>' });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.zeptomail.com', port: 465, secure: true }),
    );
  });

  it('defaults to STARTTLS (secure: false) on port 587, not implicit SSL', async () => {
    process.env = { ...OLD_ENV, SMTP_HOST: 'smtp.zeptomail.com', SMTP_PORT: '587', SMTP_USER: 'emailapikey', SMTP_PASS: 'secret' };
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    const createTransport = jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({ sendMail: jest.fn().mockResolvedValue(undefined) } as any);
    const service = new EmailService();

    await service.send({ to: 'x@example.com', subject: 'Hi', html: '<p>hi</p>' });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false }));
  });

  it('uses the given fromName when provided — the white-label override', async () => {
    process.env = { ...OLD_ENV, GMAIL_USER: 'shop@example.com', GMAIL_APP_PASSWORD: 'pass' };
    const sendMail = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({ sendMail } as any);
    const service = new EmailService();

    await service.send({ to: 'x@example.com', subject: 'Hi', html: '<p>hi</p>', fromName: 'Iron Fuel' });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: expect.stringContaining('Iron Fuel') }));
  });

  it('returns false and logs rather than throwing when the send fails', async () => {
    process.env = { ...OLD_ENV, GMAIL_USER: 'shop@example.com', GMAIL_APP_PASSWORD: 'pass' };
    jest.spyOn(require('nodemailer'), 'createTransport').mockReturnValue({
      sendMail: jest.fn().mockRejectedValue(new Error('smtp down')),
    } as any);
    const service = new EmailService();

    const result = await service.send({ to: 'x@example.com', subject: 'Hi', html: '<p>hi</p>' });

    expect(result).toBe(false);
  });
});

describe('EmailService.send — Zoho ZeptoMail HTTPS API (takes priority over SMTP)', () => {
  const OLD_ENV = process.env;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...OLD_ENV, ZEPTOMAIL_API_TOKEN: 'test-token', ZEPTOMAIL_FROM_EMAIL: 'shop@proteinpanda.shop' };
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    delete process.env.SMTP_HOST;
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, text: async () => '' } as any);
  });

  afterEach(() => {
    process.env = OLD_ENV;
    fetchSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('calls the real ZeptoMail API endpoint with the correct auth header and payload shape', async () => {
    const service = new EmailService();

    await service.send({ to: 'customer@example.com', subject: 'Your code', html: '<p>123456</p>', fromName: 'Protein Panda' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.zeptomail.com/v1.1/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Zoho-enczapikey test-token' }),
      }),
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body).toEqual(
      expect.objectContaining({
        from: { address: 'shop@proteinpanda.shop', name: 'Protein Panda' },
        to: [{ email_address: { address: 'customer@example.com' } }],
        subject: 'Your code',
        htmlbody: '<p>123456</p>',
      }),
    );
  });

  it('is used in preference to SMTP when both are configured — the API path exists specifically because SMTP is blocked on some hosts', async () => {
    process.env.SMTP_HOST = 'smtp.zeptomail.com';
    process.env.SMTP_USER = 'emailapikey';
    process.env.SMTP_PASS = 'secret';
    const createTransport = jest.spyOn(require('nodemailer'), 'createTransport');
    const service = new EmailService();

    await service.send({ to: 'x@example.com', subject: 'Hi', html: '<p>hi</p>' });

    expect(fetchSpy).toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('returns false and logs rather than throwing when the API responds with an error status', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorised' } as any);
    const service = new EmailService();

    const result = await service.send({ to: 'x@example.com', subject: 'Hi', html: '<p>hi</p>' });

    expect(result).toBe(false);
  });

  it('never throws even if the network request itself fails', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const service = new EmailService();

    await expect(service.send({ to: 'x@example.com', subject: 'Hi', html: '<p>hi</p>' })).resolves.toBe(false);
  });
});
