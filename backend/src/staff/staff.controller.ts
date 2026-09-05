import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { OwnerOnlyGuard } from '../common/owner-only.guard';
import { StaffService } from './staff.service';

@Controller('admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard, OwnerOnlyGuard)
@Roles(Role.ADMIN)
export class StaffController {
  constructor(private staff: StaffService) {}

  @Get()
  list() {
    return this.staff.listStaff();
  }

  @Post()
  create(@Body() body: any) {
    return this.staff.createStaff(body);
  }

  @Patch(':userId')
  update(@Req() req: any, @Param('userId') userId: string, @Body() body: any) {
    return this.staff.updateStaff(userId, body, req.user.userId, req.user.role);
  }

  @Patch(':userId/active')
  setActive(@Req() req: any, @Param('userId') userId: string, @Body('isActive') isActive: boolean) {
    return this.staff.setActive(userId, isActive, req.user.userId);
  }
}
