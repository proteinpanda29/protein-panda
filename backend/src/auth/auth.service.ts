import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma.service';
import { OtpDispatchService } from '../notifications/otp-dispatch.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// bcrypt cost factor for hashing OTP codes specifically — deliberately
// lower than a typical password hash (cost 12+). The threat model here
// is different: an OTP already expires in 5 minutes and is protected
// by a strict rate limit (5 verify attempts/minute/IP) — that's what
// actually stops brute-forcing, not the hash cost. bcrypt's job here is
// just to protect against someone with read access to the OtpCode table
// directly (offline cracking), a narrower concern that doesn't need
// password-grade cost. Cost 8 is roughly 4x faster than cost 10 at
// verify time — a real, meaningful concurrency improvement under load,
// while the actual anti-brute-force protection is unchanged.
const OTP_BCRYPT_COST = 8;

function isEmail(identifier: string): boolean {
  return EMAIL_RE.test(identifier);
}

// A fixed bypass code accepted ONLY when E2E_TEST_MODE is explicitly
// set to 'true' — lets automated end-to-end tests complete a real login
// without needing a live SMS/email inbox to read the actual OTP from
// (which is impossible anyway, by design: OTP codes are bcrypt-hashed
// before storage and are never retrievable in plaintext after the
// fact — see the codeHash column, not a raw code column). This does
// NOT touch that hashing/storage path at all; it's a narrow, explicit,
// separately-gated addition. Never set E2E_TEST_MODE=true in a real
// deployment — doing so would let anyone log in as anyone using this
// fixed code, so it must only ever be set in a disposable test
// environment, never production.
const E2E_TEST_BYPASS_CODE = '000000';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private otpDispatch: OtpDispatchService,
  ) {}

  /**
   * Step 1 of login/signup. `identifier` is either a mobile number or an
   * email address — no password is ever collected or stored anywhere in
   * this app. An OTP is generated and stored keyed to the raw identifier
   * regardless of whether an account exists yet for it: this both avoids
   * leaking which numbers/emails are registered, and lets a brand-new
   * customer sign up with the exact same flow as logging in.
   */
  async requestOtp(identifier: string) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, OTP_BCRYPT_COST);

    const user = await this.findUserByIdentifier(identifier);

    await this.prisma.otpCode.create({
      data: {
        identifier,
        userId: user?.id,
        codeHash,
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    // Fire-and-forget, deliberately not awaited. This used to block the
    // whole HTTP response on the actual email/SMS send completing —
    // meaning a slow or hanging SMTP connection (a real, observed thing
    // on some cloud platforms' outbound network) left the frontend
    // stuck with no response and no error at all, since the request
    // itself never finished. The OTP is already safely stored above;
    // the person doesn't need to wait for delivery confirmation to move
    // to the code-entry screen — they need the response back, and the
    // code to sms/email its way to them separately, on its own time.
    this.otpDispatch.sendOtp(identifier, code).catch(() => undefined);

    return { message: 'If this number or email is registered, an OTP has been sent.' };
  }

  /**
   * Step 2. If no account exists yet for this identifier, one is created
   * automatically as a CUSTOMER (self-signup) — admin and delivery
   * accounts are provisioned separately by the business and are never
   * created through this self-service flow.
   */
  async verifyOtp(identifier: string, code: string, name?: string, gymName?: string, referredByCode?: string, deviceInfo?: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { identifier, purpose: 'LOGIN', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp || otp.expiresAt < new Date()) {
      throw new UnauthorizedException('OTP expired or not found');
    }

    const valid =
      (process.env.E2E_TEST_MODE === 'true' && code === E2E_TEST_BYPASS_CODE) ||
      (await bcrypt.compare(code, otp.codeHash));
    if (!valid) throw new UnauthorizedException('Invalid code');

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    let user = await this.findUserByIdentifier(identifier);
    let isNewUser = false;

    if (user && !user.isActive) {
      throw new UnauthorizedException('This account has been deactivated. Contact the shop for help.');
    }

    if (!user) {
      isNewUser = true;
      const isEmailIdentifier = isEmail(identifier);

      // Silently ignored if it doesn't match a real customer's own
      // referralCode — a stale, mistyped, or made-up code should never
      // block someone from signing up. Not validated against the new
      // user's own identity since they don't have one yet at this
      // point, so self-referral isn't preventable here — see
      // checkFirstOrderReferralReward for the actual anti-abuse gate.
      let validatedReferrerCode: string | undefined;
      if (referredByCode?.trim()) {
        const referrer = await this.prisma.customer.findUnique({ where: { referralCode: referredByCode.trim() } });
        if (referrer) validatedReferrerCode = referredByCode.trim();
      }

      user = await this.prisma.user.create({
        data: {
          role: 'CUSTOMER',
          phone: isEmailIdentifier ? null : identifier,
          email: isEmailIdentifier ? identifier : null,
          customer: {
            create: {
              name: name?.trim() || 'Member',
              // Entirely opt-in — a blank/omitted gym means this customer
              // is simply never included in any gym-vs-gym leaderboard.
              gymName: gymName?.trim() || null,
              referredByCode: validatedReferrerCode,
            },
          },
        },
      });
    }

    const sessionId = await this.createSession(user.id, deviceInfo);
    // Only ever looked up for ADMIN-portal logins — customer and
    // delivery accounts have no department concept at all, so this
    // stays an empty array for them and the JWT payload simply omits it.
    let departments: string[] = [];
    if (user.role === 'ADMIN') {
      const staff = await this.prisma.staff.findUnique({ where: { userId: user.id }, select: { departments: true } });
      departments = staff?.departments ?? [];
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      identifier,
      sessionId,
      departments,
    });

    return { accessToken, role: user.role, isNewUser, departments, userId: user.id };
  }

  /**
   * Google Sign-In — verifies the ID token Google's own client-side
   * library already produced (nothing is taken on trust from the
   * browser; the token's signature, audience, and issuer are all
   * checked server-side against Google's own public keys). Matches an
   * existing account by email, or self-signs-up a new CUSTOMER account
   * exactly like first-time OTP login does — deliberately the same
   * account-creation path, not a parallel one, so a person who signs
   * up via Google and later logs in via email OTP (or vice versa)
   * lands on the same account rather than two separate ones.
   */
  async verifyGoogleToken(idToken: string, deviceInfo?: string) {
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new UnauthorizedException('Google Sign-In is not configured');
    }

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google sign-in — please try again');
    }
    if (!payload?.email) {
      throw new UnauthorizedException('Could not read an email address from your Google account');
    }
    // Google verifies the email itself before ever issuing a token for
    // it — email_verified being false here would mean the account's
    // own email isn't confirmed on Google's side, not something this
    // app can fix by proceeding anyway.
    if (payload.email_verified === false) {
      throw new UnauthorizedException('Your Google account email is not verified');
    }

    let user = await this.prisma.user.findUnique({ where: { email: payload.email } });

    if (user && !user.isActive) {
      throw new UnauthorizedException('This account has been deactivated. Contact the shop for help.');
    }

    const isNewUser = !user;
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          role: 'CUSTOMER',
          email: payload.email,
          customer: { create: { name: payload.name?.trim() || 'Member' } },
        },
      });
    }

    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role, identifier: payload.email, sessionId: await this.createSession(user.id, deviceInfo) });

    return { accessToken, role: user.role, isNewUser, userId: user.id };
  }

  /**
   * A short, human-readable device label parsed from a raw User-Agent
   * string — good enough for a person to tell "Chrome on Windows" apart
   * from "Safari on iPhone" in their account settings, without needing
   * real device fingerprinting or a third-party parsing library for
   * what's ultimately just a nice-to-have label, not a security
   * mechanism (the actual security is the session id itself).
   */
  private parseDeviceInfo(userAgent?: string): string | undefined {
    if (!userAgent) return undefined;
    const browser = /edg/i.test(userAgent) ? 'Edge' : /chrome/i.test(userAgent) ? 'Chrome' : /firefox/i.test(userAgent) ? 'Firefox' : /safari/i.test(userAgent) ? 'Safari' : 'Browser';
    const os = /android/i.test(userAgent) ? 'Android' : /iphone|ipad/i.test(userAgent) ? 'iOS' : /windows/i.test(userAgent) ? 'Windows' : /mac os/i.test(userAgent) ? 'macOS' : /linux/i.test(userAgent) ? 'Linux' : 'Unknown device';
    return `${browser} on ${os}`;
  }

  private async createSession(userId: string, userAgent?: string): Promise<string> {
    const session = await this.prisma.session.create({
      data: { userId, deviceInfo: this.parseDeviceInfo(userAgent) },
    });
    return session.id;
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s: { id: string }) => ({ ...s, isCurrent: s.id === currentSessionId }));
  }

  /** "Log out this device" — the whole reason a real session record exists instead of just a stateless JWT. */
  async revokeSession(userId: string, sessionId: string, currentSessionId?: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new UnauthorizedException('Session not found');
    }
    await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    return { revoked: true, wasCurrentSession: sessionId === currentSessionId };
  }

  private findUserByIdentifier(identifier: string) {
    return isEmail(identifier)
      ? this.prisma.user.findUnique({ where: { email: identifier } })
      : this.prisma.user.findUnique({ where: { phone: identifier } });
  }

  /**
   * Step 1 of changing a logged-in customer's phone/email — sends an OTP
   * to the NEW identifier to prove they actually control it before the
   * change takes effect. Reuses the same OtpCode table as login, keyed
   * by a distinct purpose so a login OTP can never be replayed here (or
   * vice versa).
   */
  async requestContactChange(userId: string, newIdentifier: string) {
    const existing = await this.findUserByIdentifier(newIdentifier);
    if (existing && existing.id !== userId) {
      throw new UnauthorizedException('This phone number or email is already registered to another account');
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, OTP_BCRYPT_COST);

    await this.prisma.otpCode.create({
      data: {
        identifier: newIdentifier,
        userId,
        codeHash,
        purpose: 'CONTACT_CHANGE',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    // Same fix as the login OTP path above — fire-and-forget, not
    // awaited, for the same reason: a slow/hanging SMTP or SMS provider
    // must never leave this request stuck with no response.
    this.otpDispatch.sendOtp(newIdentifier, code).catch(() => undefined);
    return { message: 'OTP sent to the new phone number or email.' };
  }

  /** Step 2 — verifies the code and actually updates the account's phone or email. */
  async confirmContactChange(userId: string, newIdentifier: string, code: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { identifier: newIdentifier, userId, purpose: 'CONTACT_CHANGE', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt < new Date()) {
      throw new UnauthorizedException('This code has expired — request a new one');
    }
    const valid = await bcrypt.compare(code, otp.codeHash);
    if (!valid) throw new UnauthorizedException('Incorrect code');

    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    await this.prisma.user.update({
      where: { id: userId },
      data: isEmail(newIdentifier) ? { email: newIdentifier } : { phone: newIdentifier },
    });
    return { message: 'Contact details updated.' };
  }
}
