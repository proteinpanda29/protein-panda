import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { Departments } from '../common/departments.decorator';
import { PosService } from './pos.service';

@Controller('admin/pos')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.SALES)
export class PosController {
  constructor(private pos: PosService) {}

  @Get('customers')
  searchCustomers(@Query('q') q: string) {
    return this.pos.searchCustomers(q);
  }

  @Get('customers/:id/redemptions')
  availableRedemptions(@Param('id') id: string) {
    return this.pos.listAvailableRedemptions(id);
  }

  @Post('customers')
  createWalkInCustomer(@Body() body: { name: string; identifier: string }) {
    return this.pos.createWalkInCustomer(body.name, body.identifier);
  }

  @Post('orders')
  createSale(@Req() req: any, @Body() body: any) {
    return this.pos.createSale(req.user.userId, body);
  }
}
