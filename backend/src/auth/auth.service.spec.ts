import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

function makePrisma(overrides: Partial<any> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'user-new', role: data.role, phone: data.phone, email: data.email })),
      update: jest.fn().mockResolvedValue({}),
    },
    otpCode: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    customer: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    session: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'session-new', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    staff: { findUnique: jest.fn().mockResolvedValue(null) },
    ...overrides,
  } as any;
}

function makeJwt() {
  return { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') } as any;
}

function makeOtpDispatch() {
  return { sendOtp: jest.fn().mockResolvedValue(undefined) } as any;
}

describe('AuthService.requestOtp', () => {
  it('hashes the OTP at a lower bcrypt cost than a password would use — rate limiting and short expiry are the real defense here, not hash cost', async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.requestOtp('+919876543210');

    const call = prisma.otpCode.create.mock.calls[0][0];
    // bcrypt hashes embed their cost as the second $-delimited segment,
    // zero-padded to two digits (e.g. "$2b$08$..." = cost 8).
    expect(call.data.codeHash).toMatch(/^\$2[aby]\$08\$/);
  });

  it('stores the OTP keyed to the raw identifier even when no account exists yet', async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.requestOtp('+919876543210');

    expect(prisma.otpCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ identifier: '+919876543210', userId: undefined }),
    });
  });

  it('dispatches the OTP through the notification service (email/SMS)', async () => {
    const prisma = makePrisma();
    const otpDispatch = makeOtpDispatch();
    const service = new AuthService(prisma, makeJwt(), otpDispatch);

    await service.requestOtp('+919876543210');

    expect(otpDispatch.sendOtp).toHaveBeenCalledWith('+919876543210', expect.stringMatching(/^\d{6}$/));
  });

  it('links the OTP to an existing user id when the identifier is already registered', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'CUSTOMER', isActive: true });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.requestOtp('user@example.com');

    expect(prisma.otpCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ identifier: 'user@example.com', userId: 'user-1' }),
    });
  });

  it('looks up by email vs phone depending on the identifier shape', async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.requestOtp('user@example.com');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'user@example.com' } });

    await service.requestOtp('+919876543210');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { phone: '+919876543210' } });
  });

  it('returns the same non-revealing message regardless of whether the account exists', async () => {
    const prismaKnown = makePrisma();
    prismaKnown.user.findUnique.mockResolvedValue({ id: 'user-1', isActive: true });
    const knownResult = await new AuthService(prismaKnown, makeJwt(), makeOtpDispatch()).requestOtp('known@example.com');

    const prismaUnknown = makePrisma();
    const unknownResult = await new AuthService(prismaUnknown, makeJwt(), makeOtpDispatch()).requestOtp('unknown@example.com');

    expect(knownResult).toEqual(unknownResult);
  });
});

describe('AuthService.verifyOtp', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('rejects the E2E bypass code when E2E_TEST_MODE is not set — this must never work in a normal deployment', async () => {
    delete process.env.E2E_TEST_MODE;
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10), // the real code is NOT '000000'
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyOtp('+919876543210', '000000')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects the E2E bypass code even with E2E_TEST_MODE=true if it is not exactly "000000"', async () => {
    process.env = { ...OLD_ENV, E2E_TEST_MODE: 'true' };
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyOtp('+919876543210', '111111')).rejects.toThrow(UnauthorizedException);
  });

  it('accepts the E2E bypass code only when E2E_TEST_MODE=true is explicitly set', async () => {
    process.env = { ...OLD_ENV, E2E_TEST_MODE: 'true' };
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10), // the real code, irrelevant — bypass short-circuits it
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'CUSTOMER', phone: '+919876543210', email: null, isActive: true });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyOtp('+919876543210', '000000')).resolves.toBeDefined();
  });

  it('rejects when no OTP was requested for this identifier', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue(null);
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyOtp('+919876543210', '123456')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired OTP', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() - 1000), // already expired
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyOtp('+919876543210', '123456')).rejects.toThrow(/expired/);
  });

  it('rejects an incorrect code', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyOtp('+919876543210', '999999')).rejects.toThrow(/Invalid code/);
  });

  it('self-signs-up a brand-new mobile identifier as a CUSTOMER', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.verifyOtp('+919876543210', '123456', 'Ravi');

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'CUSTOMER',
        phone: '+919876543210',
        email: null,
        customer: { create: { name: 'Ravi', gymName: null } },
      }),
    });
    expect(result.isNewUser).toBe(true);
    expect(result.role).toBe('CUSTOMER');
  });

  it('stores an opted-in gym name at signup for the gym-vs-gym leaderboard', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.verifyOtp('+919876543210', '123456', 'Ravi', 'Gold Gym');

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customer: { create: { name: 'Ravi', gymName: 'Gold Gym' } },
      }),
    });
  });

  it('captures a referral code at signup when it matches a real customer', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.customer.findUnique.mockResolvedValue({ id: 'referrer-1', referralCode: 'friend123' });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.verifyOtp('+919876543210', '123456', 'Ravi', undefined, 'friend123');

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customer: { create: { name: 'Ravi', gymName: null, referredByCode: 'friend123' } },
      }),
    });
  });

  it('silently ignores a referral code that does not match any real customer — a typo should never block signup', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.customer.findUnique.mockResolvedValue(null);
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.verifyOtp('+919876543210', '123456', 'Ravi', undefined, 'not-a-real-code');

    expect(result.isNewUser).toBe(true);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customer: { create: { name: 'Ravi', gymName: null } },
      }),
    });
  });

  it('self-signs-up a brand-new email identifier, defaulting the name when none is given', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.verifyOtp('new@example.com', '123456');

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: null,
        email: 'new@example.com',
        customer: { create: { name: 'Member', gymName: null } },
      }),
    });
  });

  it('does not create a new account for an existing identifier — logs in instead', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-existing', role: 'ADMIN', isActive: true });
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.verifyOtp('admin@shop.com', '123456');

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(result.isNewUser).toBe(false);
    expect(result.role).toBe('ADMIN');
  });

  it('includes the real departments in the login response for an ADMIN account', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-existing', role: 'ADMIN', isActive: true });
    prisma.staff.findUnique.mockResolvedValue({ departments: ['SUPPLY_CHAIN'] });
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.verifyOtp('admin@shop.com', '123456');

    expect(result.departments).toEqual(['SUPPLY_CHAIN']);
  });

  it('correctly returns MULTIPLE departments when a staff member genuinely holds more than one', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-existing', role: 'ADMIN', isActive: true });
    prisma.staff.findUnique.mockResolvedValue({ departments: ['OPERATIONS', 'SUPPLY_CHAIN'] });
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.verifyOtp('admin@shop.com', '123456');

    expect(result.departments).toEqual(['OPERATIONS', 'SUPPLY_CHAIN']);
  });

  it('never looks up departments for a CUSTOMER login — there is no such concept for customer accounts', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.verifyOtp('+919876543210', '123456');

    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });

  it('blocks login for a deactivated account, even with a correct OTP', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'DELIVERY', isActive: false });
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyOtp('rider@example.com', '123456')).rejects.toThrow(/deactivated/);
  });

  it('marks the OTP as consumed so it cannot be replayed', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.verifyOtp('+919876543210', '123456');

    expect(prisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('issues a JWT containing the user id, role, and identifier', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const jwt = makeJwt();
    const service = new AuthService(prisma, jwt, makeOtpDispatch());

    await service.verifyOtp('+919876543210', '123456');

    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-new', role: 'CUSTOMER', identifier: '+919876543210' }),
    );
  });
});

describe('AuthService.requestContactChange', () => {
  it('rejects a new identifier already registered to a different account', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-OTHER' });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.requestContactChange('user-1', 'taken@example.com')).rejects.toThrow(UnauthorizedException);
  });

  it('allows re-requesting for an identifier already belonging to the SAME account (e.g. retry)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    const otpDispatch = makeOtpDispatch();
    const service = new AuthService(prisma, makeJwt(), otpDispatch);

    await service.requestContactChange('user-1', 'user1@example.com');

    expect(otpDispatch.sendOtp).toHaveBeenCalledWith('user1@example.com', expect.stringMatching(/^\d{6}$/));
  });

  it('stores the OTP under the CONTACT_CHANGE purpose, distinct from LOGIN', async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.requestContactChange('user-1', 'new@example.com');

    expect(prisma.otpCode.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ purpose: 'CONTACT_CHANGE', userId: 'user-1', identifier: 'new@example.com' }) }),
    );
  });
});

describe('AuthService — session management', () => {
  it('creates a session and embeds its id in the JWT payload on OTP login', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const jwt = makeJwt();
    const service = new AuthService(prisma, jwt, makeOtpDispatch());

    await service.verifyOtp('+919876543210', '123456');

    expect(prisma.session.create).toHaveBeenCalled();
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-new' }));
  });

  it('parses a real User-Agent into a short, readable device label', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.verifyOtp('+919876543210', '123456', undefined, undefined, undefined, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0');

    expect(prisma.session.create).toHaveBeenCalledWith({ data: { userId: expect.any(String), deviceInfo: 'Chrome on Windows' } });
  });

  it('leaves deviceInfo undefined when no User-Agent was supplied at all — a missing device label is not an error', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await bcrypt.hash('123456', 10),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.verifyOtp('+919876543210', '123456');

    expect(prisma.session.create).toHaveBeenCalledWith({ data: { userId: expect.any(String), deviceInfo: undefined } });
  });

  it('lists only non-revoked sessions, most recent first', async () => {
    const prisma = makePrisma();
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.listSessions('user-1');

    expect(prisma.session.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('marks the caller\'s own current session with isCurrent, so the UI can label it and handle self-logout differently from logging out another device', async () => {
    const prisma = makePrisma();
    prisma.session.findMany.mockResolvedValue([{ id: 'session-1' }, { id: 'session-2' }]);
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.listSessions('user-1', 'session-2');

    expect(result).toEqual([
      { id: 'session-1', isCurrent: false },
      { id: 'session-2', isCurrent: true },
    ]);
  });

  it('revokes a session belonging to the requesting user', async () => {
    const prisma = makePrisma();
    prisma.session.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.revokeSession('user-1', 'session-1');

    expect(prisma.session.update).toHaveBeenCalledWith({ where: { id: 'session-1' }, data: { revokedAt: expect.any(Date) } });
    expect(result.revoked).toBe(true);
  });

  it('refuses to revoke a session belonging to a different user entirely', async () => {
    const prisma = makePrisma();
    prisma.session.findUnique.mockResolvedValue({ id: 'session-1', userId: 'someone-else' });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.revokeSession('user-1', 'session-1')).rejects.toThrow(UnauthorizedException);
  });

  it('refuses to revoke a session that does not exist at all', async () => {
    const prisma = makePrisma();
    prisma.session.findUnique.mockResolvedValue(null);
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.revokeSession('user-1', 'nonexistent')).rejects.toThrow(UnauthorizedException);
  });

  it('flags when the revoked session was the one making the request right now — the frontend needs this to know whether to immediately redirect to login', async () => {
    const prisma = makePrisma();
    prisma.session.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.revokeSession('user-1', 'session-1', 'session-1');

    expect(result.wasCurrentSession).toBe(true);
  });

  it('does not flag wasCurrentSession when revoking a different device', async () => {
    const prisma = makePrisma();
    prisma.session.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.revokeSession('user-1', 'session-1', 'session-CURRENT');

    expect(result.wasCurrentSession).toBe(false);
  });
});

describe('AuthService.confirmContactChange', () => {
  it('rejects when no matching OTP exists', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue(null);
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.confirmContactChange('user-1', 'new@example.com', '123456')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired OTP', async () => {
    const prisma = makePrisma();
    prisma.otpCode.findFirst.mockResolvedValue({ id: 'otp-1', codeHash: 'x', expiresAt: new Date(Date.now() - 1000) });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.confirmContactChange('user-1', 'new@example.com', '123456')).rejects.toThrow(/expired/);
  });

  it('rejects an incorrect code', async () => {
    const prisma = makePrisma();
    const codeHash = await bcrypt.hash('999999', 10);
    prisma.otpCode.findFirst.mockResolvedValue({ id: 'otp-1', codeHash, expiresAt: new Date(Date.now() + 60_000) });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.confirmContactChange('user-1', 'new@example.com', '111111')).rejects.toThrow(/Incorrect code/);
  });

  it('updates the email field when the new identifier is an email address', async () => {
    const prisma = makePrisma();
    const codeHash = await bcrypt.hash('654321', 10);
    prisma.otpCode.findFirst.mockResolvedValue({ id: 'otp-1', codeHash, expiresAt: new Date(Date.now() + 60_000) });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.confirmContactChange('user-1', 'new@example.com', '654321');

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { email: 'new@example.com' } });
  });

  it('updates the phone field when the new identifier is a phone number', async () => {
    const prisma = makePrisma();
    const codeHash = await bcrypt.hash('654321', 10);
    prisma.otpCode.findFirst.mockResolvedValue({ id: 'otp-1', codeHash, expiresAt: new Date(Date.now() + 60_000) });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.confirmContactChange('user-1', '+919876543210', '654321');

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { phone: '+919876543210' } });
  });

  it('marks the OTP consumed so it cannot be replayed', async () => {
    const prisma = makePrisma();
    const codeHash = await bcrypt.hash('654321', 10);
    prisma.otpCode.findFirst.mockResolvedValue({ id: 'otp-1', codeHash, expiresAt: new Date(Date.now() + 60_000) });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.confirmContactChange('user-1', 'new@example.com', '654321');

    expect(prisma.otpCode.update).toHaveBeenCalledWith({ where: { id: 'otp-1' }, data: { consumedAt: expect.any(Date) } });
  });
});

describe('AuthService.verifyGoogleToken', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, GOOGLE_CLIENT_ID: 'test-client-id' };
    mockVerifyIdToken.mockReset();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('throws if GOOGLE_CLIENT_ID is not configured — a clear, actionable error rather than a cryptic crash', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const prisma = makePrisma();
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyGoogleToken('some-token')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token that fails Google\'s own signature/audience verification', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid token'));
    const prisma = makePrisma();
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyGoogleToken('bad-token')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token whose email is not verified on Google\'s own side', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'x@example.com', email_verified: false, name: 'X' }) });
    const prisma = makePrisma();
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyGoogleToken('token')).rejects.toThrow(/not verified/);
  });

  it('creates a new CUSTOMER account for a first-time Google sign-in, same as first-time OTP signup', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'new@example.com', email_verified: true, name: 'Nisha' }) });
    const prisma = makePrisma();
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.verifyGoogleToken('token');

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { role: 'CUSTOMER', email: 'new@example.com', customer: { create: { name: 'Nisha' } } },
    });
    expect(result.isNewUser).toBe(true);
  });

  it('logs into the existing account when the email already exists — Google sign-in and email OTP land on the same account, not two separate ones', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'existing@example.com', email_verified: true, name: 'Existing' }) });
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-existing', role: 'CUSTOMER', isActive: true, email: 'existing@example.com' });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    const result = await service.verifyGoogleToken('token');

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(result.isNewUser).toBe(false);
  });

  it('refuses to log in a deactivated account, same as the OTP login path', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'blocked@example.com', email_verified: true, name: 'Blocked' }) });
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-blocked', role: 'CUSTOMER', isActive: false, email: 'blocked@example.com' });
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await expect(service.verifyGoogleToken('token')).rejects.toThrow(/deactivated/);
  });

  it('defaults to "Member" when Google does not supply a name at all', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'noname@example.com', email_verified: true }) });
    const prisma = makePrisma();
    const service = new AuthService(prisma, makeJwt(), makeOtpDispatch());

    await service.verifyGoogleToken('token');

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customer: { create: { name: 'Member' } } }) }),
    );
  });
});
