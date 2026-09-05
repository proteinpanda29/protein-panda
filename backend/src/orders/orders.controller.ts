import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, OrderStatus, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { Departments } from '../common/departments.decorator';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  @Roles(Role.CUSTOMER)
  create(@Req() req: any, @Body() body: any) {
    // customerId is resolved server-side from the authenticated user —
    // never trust a customerId passed in the request body.
    return this.orders.create({ ...body, customerId: req.user.customerId });
  }

  @Get('mine')
  @Roles(Role.CUSTOMER)
  mine(@Req() req: any, @Query('cursor') cursor?: string) {
    return this.orders.findByCustomer(req.user.customerId, 20, cursor);
  }

  @Get(':id')
  @Roles(Role.CUSTOMER)
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.orders.findOneForCustomer(req.user.customerId, id);
  }

  @Post(':id/delivery-rating')
  @Roles(Role.CUSTOMER)
  rateDelivery(@Req() req: any, @Param('id') id: string, @Body() body: { rating: number; tags?: string[]; comment?: string }) {
    return this.orders.rateDelivery(req.user.customerId, id, body.rating, body.tags ?? [], body.comment);
  }

  @Post(':id/tip')
  @Roles(Role.CUSTOMER)
  tipDeliveryPerson(@Req() req: any, @Param('id') id: string, @Body() body: { amountRs: number }) {
    return this.orders.tipDeliveryPerson(req.user.customerId, id, body.amountRs);
  }

  // Set right from a push notification action button ("Don't ring the
  // bell" / "Leave at door") — no need to open the app at all.
  @Post(':id/delivery-preference')
  @Roles(Role.CUSTOMER)
  setDeliveryPreference(@Req() req: any, @Param('id') id: string, @Body('preference') preference: 'DONT_RING_BELL' | 'LEAVE_AT_DOOR') {
    return this.orders.setDeliveryPreference(req.user.customerId, id, preference);
  }

  @Patch(':id/status')
  @UseGuards(DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN, Role.DELIVERY)
  // This one endpoint carries statuses spanning two departments'
  // legitimate day-to-day use (Operations advancing a kitchen order
  // through PREPARING/READY; Delivery Logistics marking
  // OUT_FOR_DELIVERY/ARRIVED) — restricting it to just one would
  // incorrectly lock the other out of something they genuinely need.
  // A DELIVERY-role rider has no department concept at all and passes
  // through this check regardless, same as the self-service shift
  // clock-in/out routes.
  @Departments(StaffDepartment.OPERATIONS, StaffDepartment.DELIVERY_LOGISTICS)
  updateStatus(@Param('id') id: string, @Body('status') status: OrderStatus) {
    return this.orders.updateStatus(id, status);
  }
}
