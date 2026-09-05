import { ForbiddenException } from '@nestjs/common';
import { PermissionLevelGuard } from './permission-level.guard';

function makeContext(user: any, method: string) {
  return { switchToHttp: () => ({ getRequest: () => ({ user, method }) }) } as any;
}

describe('PermissionLevelGuard', () => {
  it('always allows a GET request regardless of permission level', () => {
    const guard = new PermissionLevelGuard();
    expect(guard.canActivate(makeContext({ departments: ['SALES'], permissionLevel: 'VIEWER' }, 'GET'))).toBe(true);
  });

  it('always allows HEAD and OPTIONS too — the same "safe" methods HTTP itself defines as non-mutating', () => {
    const guard = new PermissionLevelGuard();
    expect(guard.canActivate(makeContext({ departments: ['SALES'], permissionLevel: 'VIEWER' }, 'HEAD'))).toBe(true);
    expect(guard.canActivate(makeContext({ departments: ['SALES'], permissionLevel: 'VIEWER' }, 'OPTIONS'))).toBe(true);
  });

  it('rejects a VIEWER attempting a POST', () => {
    const guard = new PermissionLevelGuard();
    expect(() => guard.canActivate(makeContext({ departments: ['SALES'], permissionLevel: 'VIEWER' }, 'POST'))).toThrow(ForbiddenException);
  });

  it('rejects a VIEWER attempting a PATCH', () => {
    const guard = new PermissionLevelGuard();
    expect(() => guard.canActivate(makeContext({ departments: ['SALES'], permissionLevel: 'VIEWER' }, 'PATCH'))).toThrow(ForbiddenException);
  });

  it('rejects a VIEWER attempting a DELETE', () => {
    const guard = new PermissionLevelGuard();
    expect(() => guard.canActivate(makeContext({ departments: ['SALES'], permissionLevel: 'VIEWER' }, 'DELETE'))).toThrow(ForbiddenException);
  });

  it('allows a MANAGER to POST/PATCH/DELETE — the original, pre-existing behavior, unchanged', () => {
    const guard = new PermissionLevelGuard();
    expect(guard.canActivate(makeContext({ departments: ['SALES'], permissionLevel: 'MANAGER' }, 'POST'))).toBe(true);
    expect(guard.canActivate(makeContext({ departments: ['SALES'], permissionLevel: 'MANAGER' }, 'PATCH'))).toBe(true);
    expect(guard.canActivate(makeContext({ departments: ['SALES'], permissionLevel: 'MANAGER' }, 'DELETE'))).toBe(true);
  });

  it('always allows the Owner (no departments at all) to write, regardless of permissionLevel', () => {
    const guard = new PermissionLevelGuard();
    expect(guard.canActivate(makeContext({ departments: [], permissionLevel: 'VIEWER' }, 'POST'))).toBe(true);
  });

  it('does not crash when departments is entirely missing from the user object (defensive default)', () => {
    const guard = new PermissionLevelGuard();
    expect(guard.canActivate(makeContext({ permissionLevel: 'VIEWER' }, 'POST'))).toBe(true);
  });
});
