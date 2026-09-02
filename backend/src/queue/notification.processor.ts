import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { INVOICE_EMAIL_QUEUE } from './queue.constants';
import { InvoiceService } from '../billing/invoice.service';

@Processor(INVOICE_EMAIL_QUEUE)
export class NotificationProcessor extends WorkerHost {
  private logger = new Logger('NotificationProcessor');

  constructor(private invoices: InvoiceService) {
    super();
  }

  async process(job: Job<{ orderId: string }>): Promise<void> {
    this.logger.log(`Sending invoice email for order ${job.data.orderId} (attempt ${job.attemptsMade + 1})`);
    await this.invoices.sendInvoiceEmail(job.data.orderId);
  }
}
