import { ForbiddenException } from '@nestjs/common';
import { OwnerOnlyGuard } from './owner-only.guard';

function makeContext(user: any) {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as any;
}

describe('OwnerOnlyGuard', () => {
  it('allows the Owner (empty departments array) through', () => {
    const guard = new OwnerOnlyGuard();
    expect(guard.canActivate(makeContext({ departments: [] }))).toBe(true);
  });

  it('allows a user with no departments field at all (customer/delivery role) through, not a crash', () => {
    const guard = new OwnerOnlyGuard();
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('rejects any department-scoped staff member, regardless of which single department', () => {
    const guard = new OwnerOnlyGuard();
    expect(() => guard.canActivate(makeContext({ departments: ['SALES'] }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(makeContext({ departments: ['FINANCE_MARKETING'] }))).toThrow(ForbiddenException);
  });

  it('rejects a staff member holding multiple departments too — holding several is still not the Owner', () => {
    const guard = new OwnerOnlyGuard();
    expect(() => guard.canActivate(makeContext({ departments: ['SALES', 'OPERATIONS'] }))).toThrow(ForbiddenException);
  });
});
