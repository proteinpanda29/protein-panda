import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WalletService } from './wallet.service';

@Injectable()
export class WalletCronService {
  private logger = new Logger('WalletCron');

  constructor(private wallet: WalletService) {}

  // Late at night so a full day's orders are captured before the
  // invoice is generated — matches the finalized policy's "automatic
  // daily billing statement" for every active subscription customer.
  @Cron('55 23 * * *')
  async handleDailyInvoices() {
    const result = await this.wallet.sendDailyInvoices();
    if (result.invoicesSent > 0) {
      this.logger.log(`Sent ${result.invoicesSent} daily wallet invoice(s)`);
    }
  }
}
