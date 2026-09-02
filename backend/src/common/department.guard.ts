import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffDepartment } from '@prisma/client';
import { DEPARTMENTS_KEY } from './departments.decorator';

@Injectable()
export class DepartmentGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredDepartments = this.reflector.getAllAndOverride<StaffDepartment[]>(DEPARTMENTS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Departments() decorator present => route is not
    // department-restricted (still gated by RolesGuard's ADMIN check).
    if (!requiredDepartments || requiredDepartments.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user; // populated by JwtAuthGuard/JwtStrategy

    // Empty/missing departments array is the Owner/full-Admin
    // convention — always passes, regardless of which departments the
    // route lists. A staff member with ANY overlap between their own
    // departments and the route's required list also passes — access
    // is a union, not an exact match, since someone can now hold more
    // than one department.
    const myDepartments: string[] = user?.departments ?? [];
    if (myDepartments.length === 0) return true;

    const hasAccess = requiredDepartments.some((d) => myDepartments.includes(d));
    if (!hasAccess) {
      throw new ForbiddenException(`This is outside your departments (${myDepartments.join(', ')}).`);
    }

    return true;
  }
}
