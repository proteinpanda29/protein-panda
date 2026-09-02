import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { AdminModule } from './admin/admin.module';
import { DeliveryModule } from './delivery/delivery.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { GamesModule } from './games/games.module';
import { RewardsModule } from './rewards/rewards.module';
import { PaymentsModule } from './payments/payments.module';
import { ShopModule } from './shop/shop.module';
import { AiModule } from './ai/ai.module';
import { AchievementsModule } from './achievements/achievements.module';
import { MembershipsModule } from './memberships/memberships.module';
import { BillingModule } from './billing/billing.module';
import { PosModule } from './pos/pos.module';
import { StaffModule } from './staff/staff.module';
import { RefundsModule } from './refunds/refunds.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { FoodSafetyModule } from './food-safety/food-safety.module';
import { NotificationCenterModule } from './notification-center/notification-center.module';
import { StaffShiftsModule } from './staff-shifts/staff-shifts.module';
import { SupportTicketsModule } from './support-tickets/support-tickets.module';
import { CashModule } from './cash/cash.module';
import { QueueModule } from './queue/queue.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { ExpensesModule } from './expenses/expenses.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(), // powers the daily membership order-generation cron
    // Registered exactly once, here at the true application root — not
    // inside QueueModule, which gets imported through more than one
    // path (OrdersModule directly, and again via PaymentsModule →
    // OrdersModule). Having forRoot() live inside a module reachable
    // multiple ways caused a genuine "circular dependency detected"
    // crash on boot; this is the standard, documented place for it.
    // Same resilience story as everywhere else Redis touches this app:
    // NotificationQueueService wraps every enqueue in a try/catch that
    // falls back to a direct call if this connection is ever
    // unreachable, so a Redis outage degrades gracefully rather than
    // losing an email.
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379', maxRetriesPerRequest: null },
    }),
    // Global default: 100 requests/minute/IP for the public API surface.
    // Individual routes (OTP, payments) override this with @Throttle().
    //
    // Redis-backed storage, not the library's in-memory default — this
    // matters the moment this app runs as more than one server process
    // (a real requirement once you're past what a single instance can
    // serve). With in-memory storage, EVERY instance tracks its own
    // separate counters, so a "5 requests/minute" limit silently becomes
    // "5 × however many instances" — each one thinks it's the only one
    // that's seen the request. Redis makes the limit a shared, correct
    // one across every instance, however many you run.
    //
    // Falls back cleanly to the library's own in-memory storage if
    // REDIS_URL isn't set, so this doesn't force a Redis dependency on
    // a single-instance deployment that doesn't need it.
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage: process.env.REDIS_URL ? new ThrottlerStorageRedisService(process.env.REDIS_URL) : undefined,
      }),
    }),
    AuthModule,
    CustomersModule,
    AdminModule,
    DeliveryModule,
    ProductsModule,
    OrdersModule,
    GamesModule,
    RewardsModule,
    PaymentsModule,
    ShopModule,
    AiModule,
    AchievementsModule,
    MembershipsModule,
    BillingModule,
    PosModule,
    StaffModule,
    RefundsModule,
    SuppliersModule,
    FoodSafetyModule,
    NotificationCenterModule,
    StaffShiftsModule,
    SupportTicketsModule,
    CashModule,
    QueueModule,
    AuditLogModule,
    ExpensesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
