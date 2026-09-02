import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Attach to a controller or route handler to restrict access by role.
 * Example: @Roles(Role.ADMIN)
 *
 * IMPORTANT: this only works in combination with JwtAuthGuard + RolesGuard.
 * Hiding a page/button on the frontend is NOT security — every protected
 * route must also enforce this server-side.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
