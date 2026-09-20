import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Three ways to send email, tried in this order:
 *
 * 1. Zoho ZeptoMail's HTTP API (ZEPTOMAIL_API_TOKEN + ZEPTOMAIL_FROM_EMAIL)
 *    — sends over HTTPS (port 443), not SMTP. This exists specifically
 *    because raw outbound SMTP (ports 25/465/587) is blocked or
 *    heavily throttled on many cloud hosting platforms, including
 *    Railway, as an anti-spam measure — confirmed with a real deploy:
 *    Gmail SMTP consistently failed with a bare "Connection timeout"
 *    there, not a credentials error, which is the signature of a
 *    network-level port block, not a config mistake. An HTTPS-based
 *    API call doesn't hit that restriction at all, since it's
 *    indistinguishable from any other outbound web request.
 * 2. Generic SMTP (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS) — works
 *    fine on hosts that don't block SMTP (a local machine, some VPS
 *    providers), just not reliably on Railway specifically.
 * 3. Gmail (GMAIL_USER/GMAIL_APP_PASSWORD) — same SMTP-port caveat as
 *    above; kept for backward compatibility and non-Railway hosting.
 */
@Injectable()
export class EmailService {
  private logger = new Logger('EmailService');
  private mailer: nodemailer.Transporter | null = null;

  isConfigured(): boolean {
    return !!(
      (process.env.ZEPTOMAIL_API_TOKEN && process.env.ZEPTOMAIL_FROM_EMAIL) ||
      (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) ||
      (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
    );
  }

  private getFromAddress(): string | undefined {
    return process.env.ZEPTOMAIL_FROM_EMAIL ?? process.env.SMTP_USER ?? process.env.GMAIL_USER;
  }

  private getMailer(): nodemailer.Transporter | null {
    if (this.mailer) return this.mailer;

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      return this.mailer;
    }

    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      this.mailer = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      return this.mailer;
    }

    return null;
  }

  private async sendViaZeptoMailApi(params: { to: string; subject: string; html: string; fromName: string }): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch('https://api.zeptomail.com/v1.1/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Zoho-enczapikey ${process.env.ZEPTOMAIL_API_TOKEN}`,
        },
        body: JSON.stringify({
          from: { address: process.env.ZEPTOMAIL_FROM_EMAIL, name: params.fromName },
          to: [{ email_address: { address: params.to } }],
          subject: params.subject,
          htmlbody: params.html,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`ZeptoMail API responded ${response.status}: ${body}`);
      }
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Never throws — a failed/unconfigured email send should never break
   * whatever triggered it (an order, an OTP request, etc.). Returns
   * whether it actually sent, so callers can decide whether to log/fall
   * back to something else (e.g. WhatsApp share link).
   */
  async send(params: { to: string; subject: string; html: string; text?: string; fromName?: string }): Promise<boolean> {
    const fromName = params.fromName ?? 'Protein Panda';

    if (process.env.ZEPTOMAIL_API_TOKEN && process.env.ZEPTOMAIL_FROM_EMAIL) {
      try {
        return await this.sendViaZeptoMailApi({ to: params.to, subject: params.subject, html: params.html, fromName });
      } catch (err) {
        this.logger.error(`ZeptoMail API failed to send to ${params.to}: ${(err as Error).message}`);
        return false;
      }
    }

    const mailer = this.getMailer();
    if (!mailer) {
      this.logger.warn(
        `Email not sent (no ZEPTOMAIL_API_TOKEN, SMTP_HOST/SMTP_USER/SMTP_PASS, or GMAIL_USER/GMAIL_APP_PASSWORD configured): "${params.subject}" to ${params.to}`,
      );
      return false;
    }

    try {
      await mailer.sendMail({
        from: `"${fromName}" <${this.getFromAddress()}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text ?? params.html.replace(/<[^>]+>/g, ' '),
      });
      return true;
    } catch (err) {
      this.logger.error(`Failed to send email to ${params.to}: ${(err as Error).message}`);
      return false;
    }
  }
}
