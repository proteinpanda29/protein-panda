import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { Departments } from '../common/departments.decorator';
import { PosService } from './pos.service';
import { WalletService } from '../customers/wallet.service';

@Controller('admin/pos')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.SALES)
export class PosController {
  constructor(
    private pos: PosService,
    private wallet: WalletService,
  ) {}

  @Get('customers')
  searchCustomers(@Query('q') q: string) {
    return this.pos.searchCustomers(q);
  }

  @Get('customers/:id/wallet')
  customerWallet(@Param('id') id: string) {
    return this.wallet.getWalletOverview(id);
  }

  @Get('customers/:id/redemptions')
  availableRedemptions(@Param('id') id: string) {
    return this.pos.listAvailableRedemptions(id);
  }

  @Get('customers/:id/billable-challenges')
  billableChallenges(@Param('id') id: string) {
    return this.pos.listBillableChallenges(id);
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
