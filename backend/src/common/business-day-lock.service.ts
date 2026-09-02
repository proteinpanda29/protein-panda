import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Deliberately tiny and dependency-free (just PrismaService) so any
 * service — AdminService, RefundsService, wherever a genuinely
 * sensitive action lives — can inject this directly without pulling in
 * the whole StoreOperationsService/module and risking a circular
 * dependency. "Sensitive" here means the specific things the
 * department spec called out: price changes, refunds, cash
 * adjustments — not every single write in the app, which would make
 * routine operation impossible once a day is closed.
 */
@Injectable()
export class BusinessDayLockService {
  constructor(private prisma: PrismaService) {}

  async isTodayClosed(): Promise<boolean> {
    const businessDay = await this.prisma.businessDay.findUnique({ where: { date: startOfToday() } });
    return !!businessDay?.closedAt;
  }

  async assertNotClosed(actionDescription: string): Promise<void> {
    if (await this.isTodayClosed()) {
      throw new ForbiddenException(
        `Today's business day has been closed — ${actionDescription} now requires manager authorization to reopen the day first.`,
      );
    }
  }
}
