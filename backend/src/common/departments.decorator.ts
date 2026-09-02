import { SetMetadata } from '@nestjs/common';
import { StaffDepartment } from '@prisma/client';

export const DEPARTMENTS_KEY = 'departments';

/**
 * Attach to an admin-portal controller or route handler to restrict it
 * to specific departments. Example: @Departments(StaffDepartment.SUPPLY_CHAIN)
 *
 * A staff member with an empty departments array (the Owner/full-Admin
 * convention — see the Staff.departments docstring in schema.prisma)
 * always passes regardless of what's listed here; this decorator only
 * ever narrows access for department-scoped staff, never for the
 * owner. Must be combined with JwtAuthGuard + RolesGuard(ADMIN) +
 * DepartmentGuard, same as @Roles().
 */
export const Departments = (...departments: StaffDepartment[]) => SetMetadata(DEPARTMENTS_KEY, departments);
