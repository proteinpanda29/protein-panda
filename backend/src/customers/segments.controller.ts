import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { Departments } from '../common/departments.decorator';
import { SegmentsService, SegmentType } from './segments.service';

@Controller('admin/segments')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.FINANCE_MARKETING)
export class SegmentsController {
  constructor(private segments: SegmentsService) {}

  @Get()
  get(@Query('type') type: SegmentType) {
    return this.segments.getSegment(type);
  }
}
