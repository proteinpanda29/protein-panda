import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Stricter than DepartmentGuard: this doesn't check membership in a
 * list of allowed departments, it requires department === null/undefined
 * specifically (the Owner/full-Admin convention). Used for routes where
 * ANY department-scoped staff member — regardless of which department —
 * must be excluded, most importantly staff/department management
 * itself: a department-scoped staff member must never be able to
 * create other staff accounts or reassign departments, since that
 * would let them grant themselves broader access.
 */
@Injectable()
export class OwnerOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // populated by JwtAuthGuard/JwtStrategy

    if (user?.departments && user.departments.length > 0) {
      throw new ForbiddenException('Only the Owner/Admin can manage staff and departments.');
    }

    return true;
  }
}
