import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { OwnerOnlyGuard } from '../common/owner-only.guard';
import { BusinessRulesService, BusinessRules } from '../common/business-rules.service';

// Owner-only — same as Shop Settings. Changing the loyalty formula or
// the monthly reward target affects every customer's earnings
// business-wide, not a single department's own area.
@Controller('admin/business-rules')
@UseGuards(JwtAuthGuard, RolesGuard, OwnerOnlyGuard)
@Roles(Role.ADMIN)
export class BusinessRulesController {
  constructor(private businessRules: BusinessRulesService) {}

  @Get()
  get() {
    return this.businessRules.getRules();
  }

  @Patch()
  update(@Body() body: Partial<BusinessRules>) {
    return this.businessRules.updateRules(body);
  }
}
