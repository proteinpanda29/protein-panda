import { Body, Controller, Get, Headers, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { WhatsAppBotService } from './whatsapp-bot.service';
import { WhatsAppService } from '../queue/whatsapp.service';

/**
 * Deliberately unguarded (no JwtAuthGuard) — Meta calls this directly,
 * with no way to carry your app's own login/JWT. Safety here comes
 * from WHATSAPP_WEBHOOK_VERIFY_TOKEN (the GET handshake, checked once
 * per Meta dashboard setup) and, on every single POST afterward, from
 * verifying Meta's own request signature — see receiveMessage below.
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private logger = new Logger('WhatsAppWebhookController');

  constructor(
    private bot: WhatsAppBotService,
    private whatsapp: WhatsAppService,
  ) {}

  /**
   * Meta's one-time webhook verification handshake, required before it
   * will ever send real messages here. Meta calls this with your own
   * chosen verify token; echoing back hub.challenge (as plain text,
   * not JSON) is what completes setup in the Meta Developer dashboard.
   */
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: FastifyReply,
  ) {
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && expected && token === expected) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Verification failed');
  }

  /**
   * The real inbound traffic — every customer message arrives here.
   * Meta's webhook payload nests the actual message several levels
   * deep and can also deliver delivery/read receipts with no message
   * text at all; both are handled by simply doing nothing when the
   * expected fields aren't present, rather than erroring on a payload
   * shape this endpoint doesn't need to act on.
   */
  @Post()
  async receiveMessage(
    @Req() req: any,
    @Body() body: any,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Res() res: FastifyReply,
  ) {
    // Verified BEFORE anything else runs — a request that fails this
    // check is rejected outright, since without it there is no way to
    // tell a real customer message from anyone who found this URL and
    // POSTed a fake one (which could create a real order and a real
    // payment link in that fake "customer"'s name).
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody || !this.bot.verifyWebhookSignature(rawBody, signature)) {
      this.logger.warn('Rejected a WhatsApp webhook POST with an invalid or missing signature');
      res.status(401).send('Invalid signature');
      return;
    }

    // Acknowledge immediately — Meta requires a fast 200 response and
    // will retry aggressively (and eventually disable the webhook) if
    // this takes too long or errors, so the actual reply is sent
    // asynchronously afterward rather than being awaited before this
    // response goes out.
    res.status(200).send('OK');

    try {
      const entry = body?.entry?.[0]?.changes?.[0]?.value;
      const message = entry?.messages?.[0];
      if (!message) return; // a status update (sent/delivered/read) with no actual message — nothing to reply to

      // A tapped list row arrives as an "interactive" message type,
      // not "text" — its selection lives at interactive.list_reply.id
      // (the same "cat:<id>"/"item:<id>" string the bot generated when
      // it sent the list in the first place), while a customer's own
      // typed message is the plain "text" type.
      let text: string | undefined;
      if (message.type === 'text') {
        text = message.text?.body;
      } else if (message.type === 'interactive' && message.interactive?.list_reply) {
        text = message.interactive.list_reply.id;
      }
      if (!text?.trim()) return;

      const phone = `+${message.from}`;
      const reply = await this.bot.handleIncomingMessage(phone, text);

      if (reply.interactiveList) {
        const sent = await this.whatsapp.sendInteractiveList(phone, reply.interactiveList.bodyText, reply.interactiveList.buttonText, reply.interactiveList.sections);
        // Falls back to plain text if the interactive send fails for
        // any reason (e.g. this client doesn't support lists) — the
        // customer still gets a usable, numbered reply either way.
        if (!sent) await this.whatsapp.sendFreeformText(phone, reply.text);
      } else {
        await this.whatsapp.sendFreeformText(phone, reply.text);
      }
    } catch (err: any) {
      this.logger.error(`Failed to process inbound WhatsApp message: ${err.message}`);
    }
  }
}
