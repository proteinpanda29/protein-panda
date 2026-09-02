import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const isSameCalendarDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const isYesterday = (a: Date, b: Date) => {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const diff = Math.floor((b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0)) / oneDayMs);
  return diff === 1;
};

@Injectable()
export class StreaksService {
  /**
   * Call once per qualifying order/day. Idempotent within the same day.
   * Runs inside the order-completion transaction.
   */
  async recordQualifyingActivity(tx: Tx, customerId: string) {
    const now = new Date();
    const streak = await tx.streak.findUnique({ where: { customerId } });

    if (!streak) {
      return tx.streak.create({
        data: { customerId, currentStreakDays: 1, longestStreakDays: 1, lastQualifyingDate: now },
      });
    }

    if (streak.lastQualifyingDate && isSameCalendarDay(streak.lastQualifyingDate, now)) {
      return streak; // already counted today
    }

    const continued =
      streak.lastQualifyingDate &&
      isYesterday(new Date(streak.lastQualifyingDate), new Date(now));

    const newCurrent = continued ? streak.currentStreakDays + 1 : 1;

    return tx.streak.update({
      where: { customerId },
      data: {
        currentStreakDays: newCurrent,
        longestStreakDays: Math.max(newCurrent, streak.longestStreakDays),
        lastQualifyingDate: now,
      },
    });
  }
}
