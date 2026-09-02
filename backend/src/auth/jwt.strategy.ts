import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../common/prisma.service';

export interface JwtPayload {
  sub: string; // userId
  role: 'CUSTOMER' | 'ADMIN' | 'DELIVERY';
  identifier: string; // the mobile number or email used to log in
  // Optional — a token issued before session tracking existed has none
  // at all, and JwtStrategy.validate() below correctly skips the
  // session check entirely in that case rather than rejecting an
  // otherwise-valid, already-issued token.
  sessionId?: string;
  // The JWT's own copy is only ever used at login-response time to
  // tell the frontend what to show immediately — validate() below
  // re-fetches the real, current departments from the database on
  // every request rather than trusting this cached claim, so an admin
  // reassigning someone's departments takes effect on their very next
  // request, not whenever their week-old token happens to expire.
  departments?: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    });
  }

  async validate(payload: JwtPayload) {
    // Re-checked on every request (not just at login) so deactivating a
    // staff account takes effect immediately — the token itself stays
    // validly signed until it expires, so this is the only place that
    // actually revokes access in real time.
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    // Same real-time-revocation reasoning as isActive above, but for a
    // single device rather than the whole account — this is what makes
    // "log out this device" from account settings actually take effect
    // immediately, rather than merely being a promise that only holds
    // once the token naturally expires up to 7 days later. Tokens
    // issued before this field existed have no sessionId at all and
    // are allowed through unchanged — this only ever tightens security
    // for logins that happen after this feature ships, never breaks an
    // already-issued token.
    if (payload.sessionId) {
      const session = await this.prisma.session.findUnique({ where: { id: payload.sessionId }, select: { revokedAt: true } });
      if (!session || session.revokedAt) {
        throw new UnauthorizedException('This session has been logged out. Please log in again.');
      }
    }

    const base = { userId: payload.sub, role: payload.role, identifier: payload.identifier, sessionId: payload.sessionId };

    // Attach the role-specific profile id so controllers never have to trust
    // a client-supplied customerId/deliveryPersonId — it's derived server-side
    // from the authenticated JWT on every request.
    if (payload.role === 'CUSTOMER') {
      const customer = await this.prisma.customer.findUnique({ where: { userId: payload.sub } });
      return { ...base, customerId: customer?.id };
    }

    if (payload.role === 'DELIVERY') {
      const deliveryPerson = await this.prisma.deliveryPerson.findUnique({ where: { userId: payload.sub } });
      return { ...base, deliveryPersonId: deliveryPerson?.id };
    }

    if (payload.role === 'ADMIN') {
      // Re-fetched live, not read from the token — see the departments
      // field's docstring above for why this can't be trusted from the
      // JWT payload alone.
      const staff = await this.prisma.staff.findUnique({ where: { userId: payload.sub }, select: { departments: true } });
      return { ...base, departments: staff?.departments ?? [] };
    }

    return base;
  }
}
