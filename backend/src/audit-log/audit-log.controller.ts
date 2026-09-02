import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { OwnerOnlyGuard } from '../common/owner-only.guard';
import { AuditLogService } from './audit-log.service';

// Owner-only — matches "Security... Audit logs" being explicitly
// listed under Admin/Owner Control in the department document, not any
// single department's own area. A department-scoped staff member
// (even one with full Sales access) should never be able to read the
// trail of what other staff have done across the whole business.
@Controller('admin/audit-log')
@UseGuards(JwtAuthGuard, RolesGuard, OwnerOnlyGuard)
@Roles(Role.ADMIN)
export class AuditLogController {
  constructor(private auditLog: AuditLogService) {}

  @Get()
  list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.auditLog.list({ entityType, entityId, actorUserId, cursor });
  }
}
