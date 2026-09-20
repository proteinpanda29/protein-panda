import { Module } from '@nestjs/common';
import { GamesService } from './games.service';
import { GamesController } from './games.controller';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { PointsService } from '../points/points.service';
import { AchievementsModule } from '../achievements/achievements.module';
import { UploadsService } from '../admin/uploads.service';

@Module({
  imports: [AchievementsModule],
  controllers: [GamesController],
  providers: [GamesService, PrismaService, RedisService, PointsService, UploadsService],
})
export class GamesModule {}
