import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { Departments } from '../common/departments.decorator';
import { RefundsService } from './refunds.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
export class RefundsController {
  constructor(private refunds: RefundsService) {}

  @Post('orders/:id/cancel')
  @Roles(Role.CUSTOMER)
  cancelMyOrder(@Req() req: any, @Param('id') id: string, @Body('reason') reason: string) {
    return this.refunds.cancelOrder(id, {
      reason,
      isCustomerInitiated: true,
      customerId: req.user.customerId,
    });
  }

  @Post('admin/orders/:id/cancel')
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.SALES)
  adminCancelOrder(@Req() req: any, @Param('id') id: string, @Body('reason') reason: string) {
    return this.refunds.cancelOrder(id, {
      reason,
      isCustomerInitiated: false,
      initiatedByUserId: req.user.userId,
    });
  }

  @Post('admin/orders/:id/refund')
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.SALES)
  adminRefund(@Req() req: any, @Param('id') id: string, @Body() body: { amountRs: number; reason: string; method?: 'CASH' | 'RAZORPAY' | 'WALLET' }) {
    return this.refunds.processRefund(id, req.user.userId, body);
  }

  @Get('admin/orders/:id/refunds')
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.SALES)
  refundsForOrder(@Param('id') id: string) {
    return this.refunds.listRefundsForOrder(id);
  }

  @Get('admin/refunds')
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.SALES)
  allRefunds() {
    return this.refunds.listAllRefunds();
  }

  @Patch('admin/refunds/:id/confirm-cash')
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.SALES)
  confirmCashRefund(@Param('id') id: string) {
    return this.refunds.confirmCashRefund(id);
  }
}
