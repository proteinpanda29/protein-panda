import { Injectable } from '@nestjs/common';
import { PrismaClient, PointsSourceType } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { PointsService } from '../points/points.service';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class AchievementsService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
  ) {}

  private async unlock(tx: Tx, customerId: string, code: string) {
    const definition = await tx.achievementDefinition.findUnique({ where: { code } });
    if (!definition) return; // not seeded — silently skip rather than error mid-transaction

    const existing = await tx.customerAchievement.findUnique({
      where: { customerId_achievementId: { customerId, achievementId: definition.id } },
    });
    if (existing) return; // already unlocked — idempotent

    await tx.customerAchievement.create({ data: { customerId, achievementId: definition.id } });

    // Runs inside the same transaction as the unlock itself — if this
    // fails, the whole unlock rolls back rather than silently leaving a
    // customer with an unlocked achievement and no record of it.
    await tx.notification.create({
      data: {
        customerId,
        type: 'ACHIEVEMENT',
        title: 'Achievement Unlocked! 🏆',
        body: definition.name,
      },
    });

    if (definition.pointsReward > 0) {
      await this.points.award(tx, {
        customerId,
        points: definition.pointsReward,
        sourceType: PointsSourceType.ACHIEVEMENT_UNLOCKED,
        note: `Achievement unlocked: ${definition.name}`,
      });
    }
  }

  /** Called after every completed (payment-confirmed) order. */
  async checkOrderAchievements(tx: Tx, customerId: string) {
    const [orderCount, proteinAgg] = await Promise.all([
      tx.order.count({ where: { customerId } }),
      tx.nutritionLog.aggregate({ where: { customerId }, _sum: { proteinG: true } }),
    ]);

    if (orderCount >= 1) await this.unlock(tx, customerId, 'FIRST_ORDER');
    if (orderCount >= 10) await this.unlock(tx, customerId, 'ORDERS_10');
    if (orderCount >= 50) await this.unlock(tx, customerId, 'ORDERS_50');
    if (orderCount >= 100) await this.unlock(tx, customerId, 'ORDERS_100');

    const totalProtein = Number(proteinAgg._sum.proteinG ?? 0);
    if (totalProtein >= 1000) await this.unlock(tx, customerId, 'PROTEIN_TOTAL_1000');
  }

  /** Called after a streak update, with the customer's new current streak length. */
  async checkStreakAchievements(tx: Tx, customerId: string, currentStreakDays: number) {
    if (currentStreakDays >= 7) await this.unlock(tx, customerId, 'STREAK_7');
    if (currentStreakDays >= 30) await this.unlock(tx, customerId, 'STREAK_30');
  }

  /** Called after logging a game attempt. */
  async checkGameAchievements(tx: Tx, customerId: string) {
    const winCount = await tx.gameAttempt.count({ where: { customerId, didWin: true } });
    if (winCount >= 1) await this.unlock(tx, customerId, 'FIRST_GAME_WIN');
    if (winCount >= 10) await this.unlock(tx, customerId, 'GAME_WINS_10');
  }

  /** Checked once per day-of-nutrition-log — a single day hitting 100g+ protein. */
  async checkDailyProteinAchievement(tx: Tx, customerId: string, todayProteinG: number) {
    if (todayProteinG >= 100) await this.unlock(tx, customerId, 'PROTEIN_DAY_100');
  }

  async listForCustomer(customerId: string) {
    const [definitions, unlocked] = await Promise.all([
      this.prisma.achievementDefinition.findMany({ orderBy: { pointsReward: 'asc' } }),
      this.prisma.customerAchievement.findMany({ where: { customerId } }),
    ]);
    const unlockedIds = new Set(unlocked.map((u: { achievementId: string }) => u.achievementId));
    const unlockedAtById = new Map(unlocked.map((u: { achievementId: string; unlockedAt: Date }) => [u.achievementId, u.unlockedAt]));

    return definitions.map((d: any) => ({
      code: d.code,
      name: d.name,
      description: d.description,
      icon: d.icon,
      pointsReward: d.pointsReward,
      unlocked: unlockedIds.has(d.id),
      unlockedAt: unlockedAtById.get(d.id) ?? null,
    }));
  }
}
