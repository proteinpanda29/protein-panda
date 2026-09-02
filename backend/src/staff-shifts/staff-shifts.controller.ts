import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { Departments } from '../common/departments.decorator';
import { StaffShiftsService } from './staff-shifts.service';

@Controller('staff-shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.DELIVERY)
export class StaffShiftsController {
  constructor(private staffShifts: StaffShiftsService) {}

  @Post('clock-in')
  clockIn(@Req() req: any) {
    return this.staffShifts.clockIn(req.user.userId);
  }

  @Post('clock-out')
  clockOut(@Req() req: any, @Body('note') note?: string) {
    return this.staffShifts.clockOut(req.user.userId, note);
  }

  @Get('current')
  current(@Req() req: any) {
    return this.staffShifts.getCurrentShift(req.user.userId);
  }

  @Get('mine')
  mine(@Req() req: any) {
    return this.staffShifts.listMyShifts(req.user.userId);
  }
}

// Deliberately separate from the self-service controller above — every
// staff member (any department, or a delivery rider with no department
// concept at all) needs to clock themselves in/out regardless of role,
// so that controller stays department-unrestricted on purpose. Viewing
// the WHOLE TEAM's shift history, below, is a genuine Operations
// concern — running the shop day-to-day includes knowing who's
// actually working when.
@Controller('admin/staff-shifts')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.OPERATIONS)
export class AdminStaffShiftsController {
  constructor(private staffShifts: StaffShiftsService) {}

  @Get()
  all(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.staffShifts.listAllShifts({ dateFrom, dateTo });
  }
}
