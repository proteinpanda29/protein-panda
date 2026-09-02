import { Module } from '@nestjs/common';
import { NotificationCenterService } from './notification-center.service';
import { NotificationCenterController, AnnouncementsController } from './notification-center.controller';
import { PushNotificationService } from './push-notification.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [NotificationCenterController, AnnouncementsController],
  providers: [NotificationCenterService, PushNotificationService, PrismaService],
  exports: [NotificationCenterService],
})
export class NotificationCenterModule {}
