import { Module } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';
import { PrismaService } from '../common/prisma.service';
import { BusinessRulesService } from '../common/business-rules.service';
import { BusinessRulesController } from '../common/business-rules.controller';

@Module({
  controllers: [ShopController, BusinessRulesController],
  providers: [ShopService, PrismaService, BusinessRulesService],
  exports: [ShopService],
})
export class ShopModule {}
