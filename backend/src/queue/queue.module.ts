import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationQueueService } from './notification-queue.service';
import { NotificationProcessor } from './notification.processor';
import { WhatsAppNotificationProcessor } from './whatsapp-notification.processor';
import { WhatsAppService } from './whatsapp.service';
import { BillingModule } from '../billing/billing.module';
import { INVOICE_EMAIL_QUEUE, WHATSAPP_NOTIFICATION_QUEUE } from './queue.constants';

// @Global() — this is genuinely shared cross-cutting infrastructure
// (the same category as the exception filter or RedisService), reached
// through more than one import path (PaymentsModule directly, and
// again via PaymentsModule -> OrdersModule). Registering it once,
// globally, is simpler and more correct than every consuming module
// needing to import it individually.
//
// The actual root cause of the earlier "circular dependency detected"
// crash on boot: INVOICE_EMAIL_QUEUE used to be defined in this file,
// which created a genuine circular import — this module imports
// NotificationQueueService, which imported the constant back from
// here. Since imports execute before any other module-level code,
// notification-queue.service.ts started loading before this file's own
// constant was defined, so @InjectQueue() silently received `undefined`.
// Moving the constant to its own dependency-free file (queue.constants.ts)
// breaks the cycle entirely. Verified with a real boot test, not assumed.
@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: INVOICE_EMAIL_QUEUE }, { name: WHATSAPP_NOTIFICATION_QUEUE }),
    BillingModule,
  ],
  providers: [NotificationQueueService, NotificationProcessor, WhatsAppNotificationProcessor, WhatsAppService],
  exports: [NotificationQueueService],
})
export class QueueModule {}
