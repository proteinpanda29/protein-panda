import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { getLevelForXp } from './levels';
import { WalletService } from './wallet.service';
import { AttendanceService } from '../streaks/attendance.service';

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private attendance: AttendanceService,
  ) {}

  async getWalletTransactions(customerId: string) {
    return this.wallet.listTransactions(customerId, this.prisma);
  }

  async getDashboard(customerId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [customer, todayLogs, streak, pointsBalance, activeGoal, xpAgg, monthlyProgress] = await Promise.all([
      this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } }),
      this.prisma.nutritionLog.findMany({
        where: { customerId, loggedAt: { gte: startOfToday } },
      }),
      this.prisma.streak.findUnique({ where: { customerId } }),
      this.prisma.pointsBalance.findUnique({ where: { customerId } }),
      this.prisma.proteinGoalRun.findFirst({ where: { customerId, completedAt: null } }),
      // XP is lifetime points EARNED (never reduced by spending points on
      // rewards) — a level, once reached, should never regress just
      // because the customer redeemed something.
      this.prisma.pointsLedgerEntry.aggregate({
        where: { customerId, points: { gt: 0 } },
        _sum: { points: true },
      }),
      this.attendance.getMonthlyProgress(this.prisma, customerId),
    ]);

    const todayProteinG = todayLogs.reduce((sum: number, l: { proteinG: unknown }) => sum + Number(l.proteinG), 0);
    const todayCalories = todayLogs.reduce((sum: number, l: { calories: number }) => sum + l.calories, 0);
    // carbsG/fatG/fibreG were always logged (NutritionLog has always had
    // these columns) but never actually summed or returned here — the
    // customer-facing "today" summary only ever showed 2 of 5 tracked
    // nutrients, which is exactly the "not accurate" gap this closes.
    const todayCarbsG = todayLogs.reduce((sum: number, l: { carbsG: unknown }) => sum + Number(l.carbsG), 0);
    const todayFatG = todayLogs.reduce((sum: number, l: { fatG: unknown }) => sum + Number(l.fatG), 0);
    const todayFibreG = todayLogs.reduce((sum: number, l: { fibreG: unknown }) => sum + Number(l.fibreG), 0);
    const xp = xpAgg._sum.points ?? 0;
    const walletBalanceRs = await this.wallet.getBalance(this.prisma, customerId);

    return {
      name: customer.name,
      goal: customer.goal,
      dietaryPreference: customer.dietaryPreference,
      dailyProteinGoalG: customer.dailyProteinGoalG,
      dailyCalorieGoal: customer.dailyCalorieGoal,
      gymName: customer.gymName,
      address: customer.address,
      referralCode: customer.referralCode,
      walletBalanceRs,
      marketingOptIn: customer.marketingOptIn,
      orderUpdatesOptIn: customer.orderUpdatesOptIn,
      today: {
        proteinG: todayProteinG,
        calories: todayCalories,
        carbsG: todayCarbsG,
        fatG: todayFatG,
        fibreG: todayFibreG,
        proteinRemainingG: customer.dailyProteinGoalG
          ? Math.max(Number(customer.dailyProteinGoalG) - todayProteinG, 0)
          : null,
      },
      streak: {
        current: streak?.currentStreakDays ?? 0,
        longest: streak?.longestStreakDays ?? 0,
      },
      points: pointsBalance?.balance ?? 0,
      activeProteinGoalRun: activeGoal,
      xpLevel: getLevelForXp(xp),
      monthlyChallenge: monthlyProgress,
    };
  }

  async updateProfile(customerId: string, data: any) {
    // Whitelisted — never let arbitrary fields (e.g. referralCode, id)
    // through a generic profile PATCH.
    const allowed = [
      'name',
      'goal',
      'dietaryPreference',
      'dailyProteinGoalG',
      'dailyCalorieGoal',
      'gymName',
      'address',
      'marketingOptIn',
      'orderUpdatesOptIn',
    ];
    const safeData: Record<string, any> = {};
    for (const key of allowed) {
      if (key in data) safeData[key] = data[key];
    }
    return this.prisma.customer.update({ where: { id: customerId }, data: safeData });
  }

  /**
   * Every piece of personal data tied to this customer, assembled into
   * one object for the "download my data" request — the frontend
   * triggers a JSON file download from this, no server-side file
   * storage involved.
   */
  async exportMyData(customerId: string) {
    return this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: {
        user: { select: { phone: true, email: true, createdAt: true } },
        allergies: { include: { allergen: true } },
        orders: { include: { items: { include: { product: { select: { name: true } } } }, payment: true } },
        nutritionLogs: true,
        pointsLedger: true,
        gameAttempts: true,
        rewardRedemptions: true,
        reviews: true,
        favourites: true,
        memberships: true,
      },
    });
  }

  /**
   * "Delete my account" — anonymizes and clears personal/health data
   * immediately (name, photo, address, gym, goals, allergies, contact
   * info) and revokes access the same way staff deactivation already
   * does (isActive=false, checked on every request including the
   * WebSocket gateway). Deliberately does NOT delete Order/Payment/
   * Refund records: those are financial/tax records tied to a stable
   * customerId that no longer carries any identifying profile data once
   * this runs, not a privacy leak — most jurisdictions require retaining
   * transaction records regardless of an account-deletion request. Any
   * active membership subscriptions are cancelled so the daily cron
   * never tries to place an order for a deleted account.
   */
  async deleteMyAccount(customerId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          name: 'Deleted User',
          profilePhotoUrl: null,
          address: null,
          gymName: null,
          goal: null,
          dietaryPreference: null,
          dailyProteinGoalG: null,
          dailyCalorieGoal: null,
          marketingOptIn: false,
        },
      });
      await tx.customerAllergy.deleteMany({ where: { customerId } });
      await tx.membership.updateMany({ where: { customerId, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
      await tx.user.update({
        where: { id: userId },
        data: { phone: null, email: null, isActive: false, deletedAt: new Date() },
      });
    });
  }

  /**
   * A shareable monthly summary. `month` is "YYYY-MM"; defaults to the
   * current month. Everything is computed on demand rather than stored,
   * so it's always accurate even for past months.
   */
  async getMonthlyReport(customerId: string, month?: string) {
    const now = new Date();
    const [year, mon] = month ? month.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
    const startOfMonth = new Date(year, mon - 1, 1);
    const startOfNextMonth = new Date(year, mon, 1);
    const dateRange = { gte: startOfMonth, lt: startOfNextMonth };

    const [orders, proteinAgg, streak, gameCount, xpAgg, orderItems, redemptions] = await Promise.all([
      this.prisma.order.count({ where: { customerId, createdAt: dateRange } }),
      this.prisma.nutritionLog.aggregate({ where: { customerId, loggedAt: dateRange }, _sum: { proteinG: true } }),
      this.prisma.streak.findUnique({ where: { customerId } }),
      this.prisma.gameAttempt.count({ where: { customerId, playedAt: dateRange } }),
      this.prisma.pointsLedgerEntry.aggregate({
        where: { customerId, points: { gt: 0 }, createdAt: dateRange },
        _sum: { points: true },
      }),
      this.prisma.orderItem.findMany({
        where: { order: { customerId, createdAt: dateRange } },
        include: { product: { select: { name: true } } },
      }),
      this.prisma.rewardRedemption.findMany({
        where: { customerId, redeemedAt: dateRange },
        include: { reward: { select: { valueRs: true } } },
      }),
    ]);

    // Favourite product this month = most-ordered by quantity.
    const qtyByProduct = new Map<string, { name: string; qty: number }>();
    for (const item of orderItems) {
      const key = item.productId;
      const existing = qtyByProduct.get(key);
      qtyByProduct.set(key, { name: item.product.name, qty: (existing?.qty ?? 0) + item.quantity });
    }
    const favourite = [...qtyByProduct.values()].sort((a, b) => b.qty - a.qty)[0] ?? null;

    const moneySavedRs = redemptions.reduce((sum: number, r: { reward: { valueRs: unknown } }) => sum + Number(r.reward.valueRs ?? 0), 0);

    return {
      month: `${year}-${String(mon).padStart(2, '0')}`,
      orders,
      proteinConsumedG: Number(proteinAgg._sum.proteinG ?? 0),
      currentStreak: streak?.currentStreakDays ?? 0,
      gamesPlayed: gameCount,
      xpEarned: xpAgg._sum.points ?? 0,
      favouriteProduct: favourite?.name ?? null,
      moneySavedRs,
    };
  }
}
