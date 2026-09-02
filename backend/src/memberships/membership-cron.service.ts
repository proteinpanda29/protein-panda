import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MembershipsService } from './memberships.service';

@Injectable()
export class MembershipCronService {
  private logger = new Logger('MembershipCron');

  constructor(private memberships: MembershipsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleDueMemberships() {
    const results = await this.memberships.generateDueOrders(new Date());
    if (results.length > 0) {
      this.logger.log(`Processed ${results.length} due membership(s): ${JSON.stringify(results)}`);
    }
  }
}
