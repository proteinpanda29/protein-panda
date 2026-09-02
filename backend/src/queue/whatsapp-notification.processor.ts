import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WHATSAPP_NOTIFICATION_QUEUE } from './queue.constants';
import { WhatsAppService } from './whatsapp.service';

@Processor(WHATSAPP_NOTIFICATION_QUEUE)
export class WhatsAppNotificationProcessor extends WorkerHost {
  private logger = new Logger('WhatsAppNotificationProcessor');

  constructor(private whatsapp: WhatsAppService) {
    super();
  }

  async process(job: Job<{ phone: string; templateName: string; variables: string[] }>): Promise<void> {
    this.logger.log(`Sending WhatsApp template "${job.data.templateName}" to ${job.data.phone} (attempt ${job.attemptsMade + 1})`);
    const sent = await this.whatsapp.sendTemplate(job.data.phone, job.data.templateName, job.data.variables);
    // Throwing (not just logging) is what makes BullMQ actually retry —
    // returning normally here would tell the queue the job succeeded
    // even when the send failed, silently defeating the retry policy.
    if (!sent) throw new Error(`WhatsApp send failed for ${job.data.phone}`);
  }
}
