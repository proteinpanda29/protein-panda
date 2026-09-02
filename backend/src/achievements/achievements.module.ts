import { Module } from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import { AchievementsController } from './achievements.controller';
import { PrismaService } from '../common/prisma.service';
import { PointsService } from '../points/points.service';
import { RedisService } from '../common/redis.service';

@Module({
  controllers: [AchievementsController],
  providers: [AchievementsService, PrismaService, PointsService, RedisService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
