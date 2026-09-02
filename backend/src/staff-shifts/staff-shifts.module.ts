import { Module } from '@nestjs/common';
import { StaffShiftsService } from './staff-shifts.service';
import { StaffShiftsController, AdminStaffShiftsController } from './staff-shifts.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [StaffShiftsController, AdminStaffShiftsController],
  providers: [StaffShiftsService, PrismaService],
})
export class StaffShiftsModule {}
