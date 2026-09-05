import { Body, Controller, Get, Param, Patch, Post, Delete, Query, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { OwnerOnlyGuard } from '../common/owner-only.guard';
import { DepartmentGuard } from '../common/department.guard';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { Departments } from '../common/departments.decorator';
import { ShopService } from './shop.service';

@Controller('shop')
export class ShopController {
  constructor(private shop: ShopService) {}

  @Get('status')
  getStatus() {
    return this.shop.getStatus();
  }

  @Patch('status')
  @UseGuards(JwtAuthGuard, RolesGuard, OwnerOnlyGuard)
  @Roles(Role.ADMIN)
  updateStatus(@Body() body: any) {
    return this.shop.updateStatus(body);
  }

  @Patch('toggle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  toggle() {
    return this.shop.toggle();
  }

  // Public — no auth. Same trust level as GET status above: no
  // sensitive data, just "how much would delivery cost here," needed
  // by checkout before the customer has necessarily committed to
  // anything, let alone placed an order.
  @Get('delivery-fee-quote')
  quoteDeliveryFee(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.shop.quoteDeliveryFee(Number(lat), Number(lng));
  }

  @Get('delivery-zones')
  @UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.DELIVERY_LOGISTICS)
  listDeliveryZones() {
    return this.shop.listDeliveryZones();
  }

  @Post('delivery-zones')
  @UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.DELIVERY_LOGISTICS)
  createDeliveryZone(@Body() body: { name: string; maxDistanceKm: number; feeRs: number; estimatedMinutes?: number }) {
    return this.shop.createDeliveryZone(body);
  }

  @Patch('delivery-zones/:id')
  @UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.DELIVERY_LOGISTICS)
  updateDeliveryZone(@Param('id') id: string, @Body() body: any) {
    return this.shop.updateDeliveryZone(id, body);
  }

  @Delete('delivery-zones/:id')
  @UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
  @Roles(Role.ADMIN)
  @Departments(StaffDepartment.DELIVERY_LOGISTICS)
  deleteDeliveryZone(@Param('id') id: string) {
    return this.shop.deleteDeliveryZone(id);
  }
}
