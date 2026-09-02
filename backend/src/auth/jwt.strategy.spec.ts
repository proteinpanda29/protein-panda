import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

function makeHarness() {
  const prisma = {
    user: { findUnique: jest.fn() },
    customer: { findUnique: jest.fn() },
    deliveryPerson: { findUnique: jest.fn() },
    session: { findUnique: jest.fn() },
    staff: { findUnique: jest.fn().mockResolvedValue(null) },
  } as any;
  const strategy = new JwtStrategy(prisma);
  return { strategy, prisma };
}

describe('JwtStrategy.validate', () => {
  it('rejects a token whose account has since been deactivated', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: false });

    await expect(
      strategy.validate({ sub: 'user-1', role: 'DELIVERY', identifier: 'rider@example.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token whose user no longer exists at all', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'deleted-user', role: 'CUSTOMER', identifier: '+919876543210' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('attaches customerId for an active CUSTOMER token', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });

    const result = await strategy.validate({ sub: 'user-1', role: 'CUSTOMER', identifier: '+919876543210' });

    expect(result).toEqual(expect.objectContaining({ userId: 'user-1', role: 'CUSTOMER', customerId: 'cust-1' }));
  });

  it('attaches deliveryPersonId for an active DELIVERY token', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.deliveryPerson.findUnique.mockResolvedValue({ id: 'dp-1' });

    const result = await strategy.validate({ sub: 'user-1', role: 'DELIVERY', identifier: 'rider@example.com' });

    expect(result).toEqual(expect.objectContaining({ deliveryPersonId: 'dp-1' }));
  });

  it('does not attempt a customer/delivery lookup for an ADMIN token', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });

    const result = await strategy.validate({ sub: 'user-1', role: 'ADMIN', identifier: 'admin@shop.com' } as any);

    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    expect(prisma.deliveryPerson.findUnique).not.toHaveBeenCalled();
    expect(result).toEqual({ userId: 'user-1', role: 'ADMIN', identifier: 'admin@shop.com', sessionId: undefined, departments: [] });
  });

  it('fetches the real, current departments live from the database — never trusts the JWT payload\'s own (possibly stale) copy', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.staff.findUnique.mockResolvedValue({ departments: ['SUPPLY_CHAIN'] });

    const result = await strategy.validate({ sub: 'user-1', role: 'ADMIN', identifier: 'admin@shop.com', departments: ['SALES'] } as any);

    // The JWT payload claimed SALES (stale/attacker-controlled), but
    // the real, current departments in the database is [SUPPLY_CHAIN] —
    // the database value must win.
    expect(result).toEqual(expect.objectContaining({ departments: ['SUPPLY_CHAIN'] }));
  });

  it('correctly returns MULTIPLE departments when a staff member genuinely holds more than one', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.staff.findUnique.mockResolvedValue({ departments: ['OPERATIONS', 'SUPPLY_CHAIN'] });

    const result = await strategy.validate({ sub: 'user-1', role: 'ADMIN', identifier: 'admin@shop.com' } as any);

    expect(result).toEqual(expect.objectContaining({ departments: ['OPERATIONS', 'SUPPLY_CHAIN'] }));
  });

  it('treats a staff member with no departments at all as the Owner (empty array), not an error', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.staff.findUnique.mockResolvedValue({ departments: [] });

    const result = await strategy.validate({ sub: 'user-1', role: 'ADMIN', identifier: 'admin@shop.com' } as any);

    expect(result).toEqual(expect.objectContaining({ departments: [] }));
  });

  it('treats an ADMIN-role user with no staff profile at all as the Owner (empty array), not a crash', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.staff.findUnique.mockResolvedValue(null);

    const result = await strategy.validate({ sub: 'user-1', role: 'ADMIN', identifier: 'admin@shop.com' } as any);

    expect(result).toEqual(expect.objectContaining({ departments: [] }));
  });

  it('rejects a token whose session has been revoked — this is what actually makes "log out this device" work immediately, not just once the token eventually expires', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.session.findUnique.mockResolvedValue({ revokedAt: new Date() });

    await expect(
      strategy.validate({ sub: 'user-1', role: 'ADMIN', identifier: 'admin@shop.com', sessionId: 'session-1' }),
    ).rejects.toThrow(/logged out/);
  });

  it('rejects a token whose session no longer exists at all (e.g. deleted)', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.session.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'user-1', role: 'ADMIN', identifier: 'admin@shop.com', sessionId: 'session-1' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a token with a session that exists and is not revoked', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.session.findUnique.mockResolvedValue({ revokedAt: null });

    await expect(
      strategy.validate({ sub: 'user-1', role: 'ADMIN', identifier: 'admin@shop.com', sessionId: 'session-1' }),
    ).resolves.toBeDefined();
  });

  it('never even queries the session table for an older token issued before this feature existed (no sessionId at all) — an already-issued token must keep working exactly as before', async () => {
    const { strategy, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ isActive: true });

    await strategy.validate({ sub: 'user-1', role: 'ADMIN', identifier: 'admin@shop.com' } as any);

    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });
});
