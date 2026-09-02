import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AiService } from './ai.service';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class AiController {
  constructor(private ai: AiService) {}

  @Post('chat')
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // LLM calls cost money — keep this tighter than general browsing
  chat(@Req() req: any, @Body('messages') messages: { role: 'user' | 'assistant'; content: string }[]) {
    return this.ai.chat(req.user.customerId, messages);
  }
}
