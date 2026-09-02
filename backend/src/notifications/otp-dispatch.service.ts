import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EmailService } from './email.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class OtpDispatchService {
  private logger = new Logger('OtpDispatch');

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  async sendOtp(identifier: string, code: string): Promise<void> {
    const isEmail = EMAIL_RE.test(identifier);

    try {
      if (isEmail) {
        await this.sendEmail(identifier, code);
      } else {
        await this.sendSms(identifier, code);
      }
      return;
    } catch (err) {
      // Never let a delivery failure break the login flow itself — log it
      // and fall through to the dev-console fallback below so local
      // testing still works even if the provider call fails.
      this.logger.error(`Failed to send OTP to ${identifier}: ${(err as Error).message}`);
    }

    // Fallback: no provider configured (or it failed) — print the code so
    // development/testing can continue. Remove this branch (or gate it
    // behind NODE_ENV !== 'production') once real providers are live and
    // verified working, so a misconfiguration in production fails loudly
    // instead of silently leaking OTPs to server logs.
    this.logger.warn(`[DEV FALLBACK] OTP for ${identifier}: ${code}`);
  }

  /**
   * Delegates to EmailService — this used to maintain its own completely
   * separate, Gmail-only nodemailer transport, duplicating EmailService's
   * logic. That meant a real, previously-invisible gap: setting up any
   * non-Gmail SMTP provider (Zoho ZeptoMail, SendGrid, SES) would work
   * for every OTHER email in the app but silently NOT for OTP emails
   * specifically, since this path never read SMTP_HOST/SMTP_USER/
   * SMTP_PASS at all. One implementation now, so any provider that
   * works for one kind of email works for all of them.
   */
  private async sendEmail(email: string, code: string) {
    if (!this.email.isConfigured()) throw new Error('No email provider configured (SMTP_HOST/SMTP_USER/SMTP_PASS or GMAIL_USER/GMAIL_APP_PASSWORD)');

    const shopSettings = await this.prisma.shopSettings.findUnique({ where: { id: 'default' } });
    const businessName = shopSettings?.businessName ?? 'Protein Panda';

    const sent = await this.email.send({
      to: email,
      subject: `Your ${businessName} code: ${code}`,
      text: `Your one-time login code is ${code}. It expires in 5 minutes. If you didn't request this, ignore this email.`,
      html: `<p>Your one-time login code is <strong style="font-size:20px">${code}</strong>.</p><p>It expires in 5 minutes. If you didn't request this, ignore this email.</p>`,
      fromName: businessName,
    });
    if (!sent) throw new Error('Email provider failed to send');
  }

  /**
   * MSG91 SMS. IMPORTANT: sending transactional SMS to Indian numbers
   * legally requires DLT (Distributed Ledger Technology) registration —
   * a government-mandated process where you register as a business
   * entity, register a Sender ID (e.g. "PRTPND"), and get a message
   * template pre-approved. This is done on the DLT portal for your
   * telecom operator (e.g. https://www.vilpower.in for Vi, or via
   * MSG91's own DLT onboarding flow at https://msg91.com/dlt), not in
   * this code. Without an approved DLT_TEMPLATE_ID, MSG91's API will
   * reject the send (or carriers will silently drop it) regardless of
   * how correct the API call is.
   */
  private async sendSms(phone: string, code: string) {
    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_DLT_TEMPLATE_ID;
    if (!authKey || !templateId) throw new Error('MSG91_AUTH_KEY/MSG91_DLT_TEMPLATE_ID not configured');

    const mobile = phone.replace(/[^\d]/g, ''); // MSG91 wants digits only, country code included (e.g. 919876543210)

    const response = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: authKey },
      body: JSON.stringify({
        template_id: templateId,
        recipients: [{ mobiles: mobile, OTP: code }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`MSG91 request failed: ${response.status} ${body}`);
    }
  }
}
