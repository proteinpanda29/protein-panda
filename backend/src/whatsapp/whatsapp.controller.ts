import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
  ) {}

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() reply: FastifyReply,
  ) {
    const result = this.whatsappService.verifyWebhook(
      mode,
      token,
      challenge,
    );

    if (result) {
      return reply.status(200).send(result);
    }

    return reply.status(403).send({
      message: 'Webhook verification failed',
    });
  }

  @Post('webhook')
  @HttpCode(200)
  async receiveWebhook(@Body() body: any) {
    await this.whatsappService.handleWebhook(body);

    return {
      received: true,
    };
  }
}
