import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { Departments } from '../common/departments.decorator';
import { ExpensesService } from './expenses.service';
import { BusinessDayLockService } from '../common/business-day-lock.service';

@Controller('admin/expenses')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.FINANCE_MARKETING)
export class ExpensesController {
  constructor(
    private expenses: ExpensesService,
    private businessDayLock: BusinessDayLockService,
  ) {}

  @Get()
  list(@Query('category') category?: string, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.expenses.listExpenses({ category, dateFrom, dateTo });
  }

  @Get('summary')
  summary(@Query('dateFrom') dateFrom: string, @Query('dateTo') dateTo: string) {
    return this.expenses.getExpenseSummary(dateFrom, dateTo);
  }

  @Post()
  async record(@Req() req: any, @Body() body: any) {
    // A recorded expense is exactly the kind of financial adjustment
    // the closed-day lock exists for — same pattern already applied to
    // price changes, refunds, and cash-shift expenses.
    await this.businessDayLock.assertNotClosed('recording an expense');
    return this.expenses.recordExpense(req.user.userId, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.businessDayLock.assertNotClosed('deleting an expense');
    return this.expenses.deleteExpense(id);
  }
}
