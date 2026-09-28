import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletService } from './wallet.service';

@Injectable()
export class WalletCronService {
  private logger = new Logger('WalletCron');

  constructor(private wallet: WalletService) {}

  // 11:55 pm shop time (India), not the server's clock, which runs on
  // UTC. Late at night so a full day's orders are captured before the
  // invoice is generated. Customers with no order that day get nothing.
  @Cron('55 23 * * *', { timeZone: 'Asia/Kolkata' })
  async handleDailyInvoices() {
    const result = await this.wallet.sendDailyInvoices();
    if (result.invoicesSent > 0) {
      this.logger.log(`Sent ${result.invoicesSent} daily wallet invoice(s)`);
    }
  }
}
