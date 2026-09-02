import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { MembershipsService } from './memberships.service';

@Controller('memberships')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class MembershipsController {
  constructor(private memberships: MembershipsService) {}

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.memberships.create(req.user.customerId, body);
  }

  @Get('mine')
  mine(@Req() req: any) {
    return this.memberships.listMine(req.user.customerId);
  }

  @Patch(':id/pause')
  pause(@Req() req: any, @Param('id') id: string) {
    return this.memberships.pause(req.user.customerId, id);
  }

  @Patch(':id/resume')
  resume(@Req() req: any, @Param('id') id: string) {
    return this.memberships.resume(req.user.customerId, id);
  }

  @Patch(':id/cancel')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.memberships.cancel(req.user.customerId, id);
  }

  @Patch(':id/skip-next')
  skipNext(@Req() req: any, @Param('id') id: string) {
    return this.memberships.skipNext(req.user.customerId, id);
  }

  @Patch(':id/scheduled-time')
  updateTime(@Req() req: any, @Param('id') id: string, @Body('scheduledTime') scheduledTime: string) {
    return this.memberships.updateScheduledTime(req.user.customerId, id, scheduledTime);
  }
}
