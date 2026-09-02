import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { Departments } from '../common/departments.decorator';
import { CashService } from './cash.service';

@Controller('admin/cash')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.FINANCE_MARKETING)
export class CashController {
  constructor(private cash: CashService) {}

  @Get('current')
  current() {
    return this.cash.getCurrentShift();
  }

  @Post('open')
  open(@Req() req: any, @Body('openingCashRs') openingCashRs: number) {
    return this.cash.openShift(req.user.userId, openingCashRs);
  }

  @Post('expense')
  expense(@Body() body: { shiftId: string; amountRs: number; note: string }) {
    return this.cash.recordExpense(body.shiftId, body.amountRs, body.note);
  }

  @Post('close')
  close(@Req() req: any, @Body() body: { shiftId: string; closingCashRs: number }) {
    return this.cash.closeShift(body.shiftId, req.user.userId, body.closingCashRs);
  }

  @Get('shifts')
  shifts() {
    return this.cash.listShifts();
  }

  @Get('shifts/:id')
  shift(@Param('id') id: string) {
    return this.cash.getShift(id);
  }

  @Get('reconciliation')
  reconciliation(@Query('dateFrom') dateFrom: string, @Query('dateTo') dateTo: string) {
    return this.cash.getReconciliationReport(dateFrom, dateTo);
  }
}
