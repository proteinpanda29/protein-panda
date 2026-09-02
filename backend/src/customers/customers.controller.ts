import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CustomersService } from './customers.service';
import { AuthService } from '../auth/auth.service';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class CustomersController {
  constructor(
    private customers: CustomersService,
    private auth: AuthService,
  ) {}

  @Get('me/dashboard')
  dashboard(@Req() req: any) {
    return this.customers.getDashboard(req.user.customerId);
  }

  @Get('me/wallet-transactions')
  walletTransactions(@Req() req: any) {
    return this.customers.getWalletTransactions(req.user.customerId);
  }

  @Patch('me/profile')
  updateProfile(@Req() req: any, @Body() body: any) {
    return this.customers.updateProfile(req.user.customerId, body);
  }

  @Get('me/monthly-report')
  monthlyReport(@Req() req: any, @Query('month') month?: string) {
    return this.customers.getMonthlyReport(req.user.customerId, month);
  }

  @Get('me/export')
  exportData(@Req() req: any) {
    return this.customers.exportMyData(req.user.customerId);
  }

  @Post('me/delete')
  deleteAccount(@Req() req: any) {
    return this.customers.deleteMyAccount(req.user.customerId, req.user.userId);
  }

  @Post('me/contact-change/request')
  requestContactChange(@Req() req: any, @Body('newIdentifier') newIdentifier: string) {
    return this.auth.requestContactChange(req.user.userId, newIdentifier);
  }

  @Post('me/contact-change/confirm')
  confirmContactChange(@Req() req: any, @Body() body: { newIdentifier: string; code: string }) {
    return this.auth.confirmContactChange(req.user.userId, body.newIdentifier, body.code);
  }
}
