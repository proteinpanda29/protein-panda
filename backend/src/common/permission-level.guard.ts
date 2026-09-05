import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Deliberately derives "view vs manage" from the HTTP method rather
 * than a per-route permission tag: GET/HEAD/OPTIONS are always
 * readable by anyone in the department (DepartmentGuard already
 * gated that); anything that changes data (POST/PATCH/PUT/DELETE)
 * requires the caller's permissionLevel to be MANAGER. This means
 * every single admin route gets correct enforcement automatically,
 * with no risk of one route being missed or miscategorized by hand.
 *
 * An Owner (no departments at all) always passes — same convention as
 * DepartmentGuard and OwnerOnlyGuard elsewhere; permissionLevel only
 * has meaning for a department-scoped staff member.
 */
@Injectable()
export class PermissionLevelGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // populated by JwtAuthGuard/JwtStrategy

    if (SAFE_METHODS.has(request.method)) return true;
    if (!user?.departments || user.departments.length === 0) return true; // Owner

    if (user.permissionLevel !== 'MANAGER') {
      throw new ForbiddenException('Your account has view-only access — this action requires a manager-level account.');
    }

    return true;
  }
}
