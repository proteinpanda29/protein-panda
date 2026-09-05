import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BusinessRulesService } from '../common/business-rules.service';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

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
  constructor(private businessRules: BusinessRulesService) {}

  /**
   * Call once per qualifying order/day, same trigger point as
   * StreaksService.recordQualifyingActivity — but this counts DISTINCT
   * days visited, not consecutive ones. A customer visiting
   * Mon/Wed/Fri/Sun all count toward the monthly target, even though
   * none of those are consecutive (which is all Streak would credit).
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
   * The monthly visit challenge itself: real distinct-day count within
   * the current calendar month, plus whether the separate
   * fitness-challenge requirement is also met — combined, these are
   * exactly the department spec's "N visits + M challenges = reward
   * eligible" rule, computed from real data against admin-configurable
   * targets (BusinessRulesService), not hardcoded numbers.
   */
  async getMonthlyProgress(prisma: Tx, customerId: string) {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = startOfNextMonth(now);

    const [visitCount, completedChallenges, rules] = await Promise.all([
      prisma.attendance.count({ where: { customerId, visitDate: { gte: monthStart, lt: monthEnd } } }),
      prisma.gameAttempt.count({ where: { customerId, didWin: true, playedAt: { gte: monthStart, lt: monthEnd } } }),
      this.businessRules.getRules(),
    ]);

    const visitsComplete = visitCount >= rules.monthlyVisitTarget;
    const challengeComplete = completedChallenges >= rules.requiredChallengesPerMonth;

    return {
      visitsThisMonth: visitCount,
      visitTarget: rules.monthlyVisitTarget,
      visitsComplete,
      challengesCompletedThisMonth: completedChallenges,
      challengeTarget: rules.requiredChallengesPerMonth,
      challengeComplete,
      rewardEligible: visitsComplete && challengeComplete,
    };
  }
}
