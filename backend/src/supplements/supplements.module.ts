import { Module } from '@nestjs/common';
import { SupplementsService } from './supplements.service';
import { SupplementsController, AdminSupplementsController } from './supplements.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [SupplementsController, AdminSupplementsController],
  providers: [SupplementsService, PrismaService],
})
export class SupplementsModule {}
