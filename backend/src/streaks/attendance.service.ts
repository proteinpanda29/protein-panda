import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// Configurable business rules — matches the department spec's own
// "Business Rule Configuration" section by naming these as named
// constants rather than burying magic numbers inline, even though
// they're not yet exposed as an admin-editable setting (that's a
// separate, larger piece of work — see the Admin/Owner Control gaps).
export const MONTHLY_VISIT_TARGET = 15;
export const REQUIRED_CHALLENGES_PER_MONTH = 1;

function dateOnly(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

@Injectable()
export class AttendanceService {
  /**
   * Call once per qualifying order/day, same trigger point as
   * StreaksService.recordQualifyingActivity — but this counts DISTINCT
   * days visited, not consecutive ones. A customer visiting
   * Mon/Wed/Fri/Sun all count toward the monthly 15, even though none
   * of those are consecutive (which is all Streak would credit).
   * Idempotent — the unique (customerId, visitDate) constraint means a
   * second qualifying order on the same day is a harmless no-op, not a
   * duplicate visit.
   */
  async recordVisit(tx: Tx, customerId: string, orderId?: string) {
    const today = dateOnly(new Date());
    const existing = await tx.attendance.findUnique({ where: { customerId_visitDate: { customerId, visitDate: today } } });
    if (existing) return existing;

    return tx.attendance.create({
      data: { customerId, visitDate: today, verificationMethod: 'POS_PURCHASE', orderId },
    });
  }

  /**
   * The monthly 15-visit challenge itself: real distinct-day count
   * within the current calendar month, plus whether the separate
   * fitness-challenge requirement is also met — combined, these are
   * exactly the department spec's "15 visits + 1 challenge = reward
   * eligible" rule, computed from real data rather than approximated.
   */
  async getMonthlyProgress(prisma: Tx, customerId: string) {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = startOfNextMonth(now);

    const [visitCount, completedChallenges] = await Promise.all([
      prisma.attendance.count({ where: { customerId, visitDate: { gte: monthStart, lt: monthEnd } } }),
      prisma.gameAttempt.count({ where: { customerId, didWin: true, playedAt: { gte: monthStart, lt: monthEnd } } }),
    ]);

    const visitsComplete = visitCount >= MONTHLY_VISIT_TARGET;
    const challengeComplete = completedChallenges >= REQUIRED_CHALLENGES_PER_MONTH;

    return {
      visitsThisMonth: visitCount,
      visitTarget: MONTHLY_VISIT_TARGET,
      visitsComplete,
      challengesCompletedThisMonth: completedChallenges,
      challengeTarget: REQUIRED_CHALLENGES_PER_MONTH,
      challengeComplete,
      rewardEligible: visitsComplete && challengeComplete,
    };
  }
}
