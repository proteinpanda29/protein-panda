import { Module } from '@nestjs/common';
import { SupplementsService } from './supplements.service';
import { SupplementsController, AdminSupplementsController } from './supplements.controller';
import { PrismaService } from '../common/prisma.service';
import { UploadsService } from '../admin/uploads.service';

@Module({
  controllers: [SupplementsController, AdminSupplementsController],
  providers: [SupplementsService, PrismaService, UploadsService],
})
export class SupplementsModule {}
