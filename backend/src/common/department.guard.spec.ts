import { ForbiddenException } from '@nestjs/common';
import { DepartmentGuard } from './department.guard';

function makeContext(user: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

function makeGuard(metadata: string[] | undefined) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(metadata) } as any;
  return new DepartmentGuard(reflector);
}

describe('DepartmentGuard', () => {
  it('allows access when the route has no @Departments() restriction at all', () => {
    const guard = makeGuard(undefined);
    const context = makeContext({ departments: ['SALES'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the Owner (empty departments array) through regardless of which departments the route requires', () => {
    const guard = makeGuard(['SUPPLY_CHAIN']);
    const context = makeContext({ departments: [] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a staff member whose single department matches one of the required ones', () => {
    const guard = makeGuard(['SUPPLY_CHAIN']);
    const context = makeContext({ departments: ['SUPPLY_CHAIN'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a staff member whose single department does not match any required one', () => {
    const guard = makeGuard(['SUPPLY_CHAIN']);
    const context = makeContext({ departments: ['SALES'] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows a staff member holding MULTIPLE departments if ANY one of them matches — access is a union', () => {
    const guard = makeGuard(['SUPPLY_CHAIN']);
    const context = makeContext({ departments: ['OPERATIONS', 'SUPPLY_CHAIN'] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a staff member holding multiple departments when NONE of them match the route', () => {
    const guard = makeGuard(['SUPPLY_CHAIN']);
    const context = makeContext({ departments: ['SALES', 'LOYALTY'] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('treats a missing departments field the same as an empty array — Owner access, not a crash', () => {
    const guard = makeGuard(['SUPPLY_CHAIN']);
    const context = makeContext({});

    expect(guard.canActivate(context)).toBe(true);
  });
});
