import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { RewardsService } from './rewards.service';
import { PdfService } from '../pdf/pdf.service';

@Controller('rewards')
export class RewardsController {
  constructor(
    private rewards: RewardsService,
    private pdf: PdfService,
  ) {}

  @Get()
  list() {
    return this.rewards.listAvailable();
  }

  @Post('redeem')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  redeem(@Req() req: any, @Body('rewardId') rewardId: string) {
    return this.rewards.redeem(req.user.customerId, rewardId);
  }

  @Get('my-redemptions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  myRedemptions(@Req() req: any) {
    return this.rewards.myRedemptions(req.user.customerId);
  }

  @Get('redemptions/:id/receipt.pdf')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  async redemptionPdf(@Req() req: any, @Param('id') id: string, @Res() res: FastifyReply) {
    await this.rewards.assertOwnsRedemption(req.user.customerId, id);
    const buffer = await this.pdf.generateRewardRedemptionPdf(id);
    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="reward-voucher-${id.slice(0, 8)}.pdf"`)
      .send(buffer);
  }
}
