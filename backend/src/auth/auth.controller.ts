import { Body, Controller, Delete, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

// Accepts either a mobile number (E.164-ish, digits/+/spaces/dashes) or an
// email address. No password field exists anywhere in this app.
const IDENTIFIER_RE = /^(\+?[0-9][0-9\s-]{7,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

class RequestOtpDto {
  @IsString()
  @Matches(IDENTIFIER_RE, { message: 'Enter a valid mobile number or email address' })
  identifier: string;
}

class GoogleLoginDto {
  @IsString()
  idToken: string;
}

class VerifyOtpDto {
  @IsString()
  @Matches(IDENTIFIER_RE, { message: 'Enter a valid mobile number or email address' })
  identifier: string;

  @IsString()
  @Length(6, 6)
  code: string;

  // Only used the first time — when this identifier has no account yet.
  @IsOptional()
  @IsString()
  name?: string;

  // Entirely optional — only powers the Gym vs Gym leaderboard if set.
  @IsOptional()
  @IsString()
  gymName?: string;

  // Only used the first time too — a friend's referral code, captured
  // from a ?ref= link. Silently ignored if it doesn't match a real
  // customer (a typo'd or stale code should never block someone from
  // signing up).
  @IsOptional()
  @IsString()
  referredByCode?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('otp/request')
  @Throttle({ default: { limit: 3, ttl: 60_000 } }) // 3 requests/minute/IP
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto.identifier);
  }

  @Post('otp/verify')
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 attempts/minute/IP
  verifyOtp(@Body() dto: VerifyOtpDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.verifyOtp(dto.identifier, dto.code, dto.name, dto.gymName, dto.referredByCode, userAgent);
  }

  @Post('google')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyGoogle(@Body() dto: GoogleLoginDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.verifyGoogleToken(dto.idToken, userAgent);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(@Req() req: any) {
    return this.authService.listSessions(req.user.userId, req.user.sessionId);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  revokeSession(@Req() req: any, @Param('id') sessionId: string) {
    return this.authService.revokeSession(req.user.userId, sessionId, req.user.sessionId);
  }
}
