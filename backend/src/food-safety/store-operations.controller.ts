import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { Departments } from '../common/departments.decorator';
import { StoreOperationsService } from './store-operations.service';

@Controller('admin/store-operations')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.OPERATIONS)
export class StoreOperationsController {
  constructor(private storeOps: StoreOperationsService) {}

  @Get('checklist-items')
  listItems(@Query('type') type: 'OPENING' | 'CLOSING') {
    return this.storeOps.listChecklistItems(type);
  }

  @Post('checklist-logs')
  submitLog(@Req() req: any, @Body() body: { type: 'OPENING' | 'CLOSING'; entries: any[] }) {
    return this.storeOps.submitLog(req.user.userId, body.type, body.entries);
  }

  @Get('today-status')
  todayStatus() {
    return this.storeOps.getTodayStatus();
  }

  @Post('close-business-day')
  closeBusinessDay(@Req() req: any) {
    return this.storeOps.closeBusinessDay(req.user.userId);
  }
}
