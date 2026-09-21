import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  /**
   * Resend HTTPS email provider.
   *
   * Required environment variables:
   *
   * RESEND_API_KEY
   * RESEND_FROM_EMAIL
   *
   * Example:
   * RESEND_FROM_EMAIL=noreply@proteinpanda.shop
   *
   * Resend uses HTTPS (port 443), so this does not depend on
   * SMTP ports such as 25, 465, or 587.
   */

  isConfigured(): boolean {
    return !!(
      process.env.RESEND_API_KEY &&
      (process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM_EMAIL)
    );
  }

  /**
   * Sends an email through Resend's HTTPS API.
   *
   * Returns:
   *   true  -> Resend accepted the email
   *   false -> configuration/API/network failure
   *
   * This method intentionally does not throw so that an email
   * provider failure does not break the operation that triggered it.
   */
  async send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    fromName?: string;
  }): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM_EMAIL;

    if (!apiKey || !fromEmail) {
      this.logger.error(
        'Resend email provider is not configured. ' +
          'Required variables: RESEND_API_KEY and (RESEND_FROM_EMAIL or SMTP_FROM_EMAIL).',
      );

      return false;
    }

    const fromName = params.fromName ?? 'Protein Panda';

    const text =
      params.text ??
      params.html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },

        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [params.to],
          subject: params.subject,
          html: params.html,
          text,
        }),
      });

      const responseBody = await response.text();

      if (!response.ok) {
        this.logger.error(
          `Resend API failed for ${params.to}: ` +
            `HTTP ${response.status} ${responseBody}`,
        );

        return false;
      }

      this.logger.log(
        `Email accepted by Resend for ${params.to}`,
      );

      return true;
    } catch (err) {
      this.logger.error(
        `Resend request failed for ${params.to}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      return false;
    }
  }
}
