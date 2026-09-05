import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { Departments } from '../common/departments.decorator';
import { CampaignsService } from './campaigns.service';
import { SegmentType } from './segments.service';

@Controller('admin/campaigns')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.FINANCE_MARKETING)
export class CampaignsController {
  constructor(private campaigns: CampaignsService) {}

  @Get()
  list() {
    return this.campaigns.listCampaigns();
  }

  @Post()
  send(@Req() req: any, @Body() body: { name: string; segmentType: SegmentType; title: string; body: string }) {
    return this.campaigns.sendCampaign(req.user.userId, body);
  }
}
