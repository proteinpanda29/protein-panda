import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';
import { FavouritesService } from './favourites.service';
import { FavouritesController } from './favourites.controller';
import { WalletService } from './wallet.service';
import { PrismaService } from '../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AttendanceService } from '../streaks/attendance.service';
import { BusinessRulesService } from '../common/business-rules.service';
import { SegmentsService } from './segments.service';
import { SegmentsController } from './segments.controller';

@Module({
  imports: [AuthModule],
  controllers: [CustomersController, AddressesController, FavouritesController, SegmentsController],
  providers: [CustomersService, AddressesService, FavouritesService, WalletService, PrismaService, AttendanceService, SegmentsService, BusinessRulesService],
  exports: [WalletService],
})
export class CustomersModule {}
