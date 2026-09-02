import { Module } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { MembershipCronService } from './membership-cron.service';
import { PrismaService } from '../common/prisma.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [MembershipsController],
  providers: [MembershipsService, MembershipCronService, PrismaService],
})
export class MembershipsModule {}
