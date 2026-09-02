import { Module } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { RewardsController } from './rewards.controller';
import { PrismaService } from '../common/prisma.service';
import { PointsService } from '../points/points.service';
import { RedisService } from '../common/redis.service';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [PdfModule],
  controllers: [RewardsController],
  providers: [RewardsService, PrismaService, PointsService, RedisService],
})
export class RewardsModule {}
