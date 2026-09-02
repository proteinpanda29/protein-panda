import { Module } from '@nestjs/common';
import { OtpDispatchService } from './otp-dispatch.service';
import { EmailService } from './email.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  providers: [OtpDispatchService, EmailService, PrismaService],
  exports: [OtpDispatchService, EmailService],
})
export class NotificationsModule {}
