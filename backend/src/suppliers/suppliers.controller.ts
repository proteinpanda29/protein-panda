import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { Departments } from '../common/departments.decorator';
import { SuppliersService } from './suppliers.service';

@Controller('admin/suppliers')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.SUPPLY_CHAIN)
export class SuppliersController {
  constructor(private suppliers: SuppliersService) {}

  @Get()
  list() {
    return this.suppliers.listSuppliers();
  }

  @Post()
  create(@Body() body: any) {
    return this.suppliers.createSupplier(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.suppliers.updateSupplier(id, body);
  }

  @Get('purchases/all')
  purchases(@Query('supplierId') supplierId?: string) {
    return this.suppliers.listPurchases(supplierId);
  }

  @Post('purchases')
  createPurchase(@Body() body: any) {
    return this.suppliers.createPurchase(body);
  }

  @Post('purchase-requests')
  createPurchaseRequest(@Req() req: any, @Body() body: { ingredientId: string; requestedQty: number; note?: string }) {
    return this.suppliers.createPurchaseRequest(req.user.userId, body);
  }

  @Get('purchase-requests')
  listPurchaseRequests(@Query('status') status?: string) {
    return this.suppliers.listPurchaseRequests(status);
  }

  @Patch('purchase-requests/:id/decide')
  decidePurchaseRequest(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { decision: 'APPROVED' | 'REJECTED'; rejectionReason?: string },
  ) {
    return this.suppliers.decidePurchaseRequest(req.user.userId, id, body.decision, body.rejectionReason);
  }
}
