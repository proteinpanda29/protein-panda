import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { SegmentsService } from './segments.service';
import { PrismaService } from '../common/prisma.service';
import { NotificationCenterModule } from '../notification-center/notification-center.module';

@Module({
  imports: [NotificationCenterModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, SegmentsService, PrismaService],
})
export class CampaignsModule {}
