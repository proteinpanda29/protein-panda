import { Injectable } from '@nestjs/common';

@Injectable()
export class WhatsappService {
  verifyWebhook(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ) {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (
      mode === 'subscribe' &&
      token === verifyToken &&
      challenge
    ) {
      return challenge;
    }

    return null;
  }

  async handleWebhook(body: any) {
    console.log(
      'WhatsApp webhook received:',
      JSON.stringify(body, null, 2),
    );

    return;
  }
}
