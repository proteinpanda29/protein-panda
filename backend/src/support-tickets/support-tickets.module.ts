import { Module } from '@nestjs/common';
import { SupportTicketsService } from './support-tickets.service';
import { SupportTicketsController, AdminSupportTicketsController } from './support-tickets.controller';
import { PrismaService } from '../common/prisma.service';
import { NotificationCenterModule } from '../notification-center/notification-center.module';

@Module({
  imports: [NotificationCenterModule],
  controllers: [SupportTicketsController, AdminSupportTicketsController],
  providers: [SupportTicketsService, PrismaService],
})
export class SupportTicketsModule {}
