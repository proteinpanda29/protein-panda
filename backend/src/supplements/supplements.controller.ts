import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role, StaffDepartment } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { DepartmentGuard } from '../common/department.guard';
import { Departments } from '../common/departments.decorator';
import { PermissionLevelGuard } from '../common/permission-level.guard';
import { SupplementsService } from './supplements.service';
import { UploadsService } from '../admin/uploads.service';

@Controller('supplements')
export class SupplementsController {
  constructor(private supplements: SupplementsService) {}

  // Public — no auth. This entire feature exists so customers can see
  // it without logging in.
  @Get()
  listPublic() {
    return this.supplements.listPublic();
  }
}

@Controller('admin/supplements')
@UseGuards(JwtAuthGuard, RolesGuard, DepartmentGuard, PermissionLevelGuard)
@Roles(Role.ADMIN)
@Departments(StaffDepartment.OPERATIONS)
export class AdminSupplementsController {
  constructor(
    private supplements: SupplementsService,
    private uploads: UploadsService,
  ) {}

  // Hardcoded to the supplements folder, never caller-supplied — same
  // reasoning as the existing products/reviews upload endpoints: a
  // fixed whitelist stops any caller from signing a request for a
  // folder they shouldn't be able to touch.
  @Get('upload-signature')
  getUploadSignature() {
    return this.uploads.getUploadSignature('protein-panda/supplements');
  }

  @Get()
  listAll() {
    return this.supplements.listAllForAdmin();
  }

  @Post('brands')
  createBrand(@Body() body: any) {
    return this.supplements.createBrand(body);
  }

  @Patch('brands/:id')
  updateBrand(@Param('id') id: string, @Body() body: any) {
    return this.supplements.updateBrand(id, body);
  }

  @Delete('brands/:id')
  deleteBrand(@Param('id') id: string) {
    return this.supplements.deleteBrand(id);
  }

  @Post('products')
  createSupplement(@Body() body: any) {
    return this.supplements.createSupplement(body);
  }

  @Patch('products/:id')
  updateSupplement(@Param('id') id: string, @Body() body: any) {
    return this.supplements.updateSupplement(id, body);
  }

  @Delete('products/:id')
  deleteSupplement(@Param('id') id: string) {
    return this.supplements.deleteSupplement(id);
  }
}
