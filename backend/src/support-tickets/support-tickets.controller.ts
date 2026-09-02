import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { Departments } from '../common/departments.decorator';
import { SupportTicketsService } from './support-tickets.service';

@Controller('support-tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
export class SupportTicketsController {
  constructor(private tickets: SupportTicketsService) {}

  @Post()
  create(@Req() req: any, @Body() body: { subject: string; body: string; orderId?: string }) {
    return this.tickets.createTicket(req.user.customerId, body.subject, body.body, body.orderId);
  }

  @Get()
  mine(@Req() req: any) {
    return this.tickets.listMyTickets(req.user.customerId);
  }

  @Get(':id')
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.tickets.getTicketForCustomer(req.user.customerId, id);
  }

  @Post(':id/reply')
  reply(@Req() req: any, @Param('id') id: string, @Body('body') body: string) {
    return this.tickets.replyAsCustomer(req.user.customerId, id, body);
  }
}

@Controller('admin/support-tickets')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.SALES)
export class AdminSupportTicketsController {
  constructor(private tickets: SupportTicketsService) {}

  @Get()
  all(@Query('status') status?: string) {
    return this.tickets.listAllTickets(status);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.tickets.getTicketForAdmin(id);
  }

  @Post(':id/reply')
  reply(@Req() req: any, @Param('id') id: string, @Body('body') body: string) {
    return this.tickets.replyAsAdmin(req.user.userId, id, body);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.tickets.updateStatus(id, status);
  }
}
