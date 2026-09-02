import { Module } from '@nestjs/common';
import { FoodSafetyService } from './food-safety.service';
import { FoodSafetyController } from './food-safety.controller';
import { StoreOperationsService } from './store-operations.service';
import { StoreOperationsController } from './store-operations.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [FoodSafetyController, StoreOperationsController],
  providers: [FoodSafetyService, StoreOperationsService, PrismaService],
})
export class FoodSafetyModule {}
