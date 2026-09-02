import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function makeContext(user: any): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('RolesGuard', () => {
  it('allows the request through when no @Roles() decorator is present', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as any;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext({ role: Role.CUSTOMER }))).toBe(true);
  });

  it('allows a request whose user role is in the required roles list', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]) } as any;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext({ role: Role.ADMIN }))).toBe(true);
  });

  it('blocks a request whose user role is not in the required roles list', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]) } as any;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext({ role: Role.DELIVERY }))).toBe(false);
  });

  it('blocks a customer from an admin-only route — the core RBAC guarantee', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]) } as any;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext({ role: Role.CUSTOMER }))).toBe(false);
  });

  it('blocks the request when there is no authenticated user at all', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]) } as any;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });

  it('allows a route restricted to multiple roles for any of those roles', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN, Role.DELIVERY]) } as any;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext({ role: Role.DELIVERY }))).toBe(true);
    expect(guard.canActivate(makeContext({ role: Role.ADMIN }))).toBe(true);
    expect(guard.canActivate(makeContext({ role: Role.CUSTOMER }))).toBe(false);
  });
});
