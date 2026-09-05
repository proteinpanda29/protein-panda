import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { Departments } from '../common/departments.decorator';
import { FoodSafetyService } from './food-safety.service';

@Controller('admin/food-safety')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.OPERATIONS)
export class FoodSafetyController {
  constructor(private foodSafety: FoodSafetyService) {}

  @Get('checklist-items')
  listItems() {
    return this.foodSafety.listChecklistItems();
  }

  @Post('checklist-items')
  createItem(@Body() body: any) {
    return this.foodSafety.createChecklistItem(body);
  }

  @Patch('checklist-items/:id')
  updateItem(@Param('id') id: string, @Body() body: any) {
    return this.foodSafety.updateChecklistItem(id, body);
  }

  @Post('logs')
  submitLog(@Req() req: any, @Body() body: any) {
    return this.foodSafety.submitLog(req.user.userId, body);
  }

  @Get('logs')
  listLogs(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.foodSafety.listLogs({ dateFrom, dateTo });
  }

  @Get('logs/:id')
  getLog(@Param('id') id: string) {
    return this.foodSafety.getLog(id);
  }

  @Get('today-status')
  todayStatus(@Query('shiftLabel') shiftLabel?: string) {
    return this.foodSafety.hasSubmittedToday(shiftLabel);
  }
}
