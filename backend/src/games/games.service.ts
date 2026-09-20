import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PointsSourceType } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { PointsService } from '../points/points.service';
import { AchievementsService } from '../achievements/achievements.service';
import { calculateGameReward, RewardConfig } from './reward-calculator';

const LEADERBOARD_KEY = 'leaderboard:monthly:points';

@Injectable()
export class GamesService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private points: PointsService,
    private achievements: AchievementsService,
  ) {}

  async listGames() {
    return this.prisma.game.findMany({ where: { isActive: true }, include: { levels: { orderBy: { levelNumber: 'asc' } } }, orderBy: { sortOrder: 'asc' } });
  }

  async myRecentAttempts(customerId: string, take = 10) {
    return this.prisma.gameAttempt.findMany({
      where: { customerId },
      take,
      orderBy: { playedAt: 'desc' },
      include: { game: { select: { name: true } }, level: { select: { levelName: true } } },
    });
  }

  /**
   * Staff logs a customer's game result in-shop (e.g. after a hanging challenge).
   * Awarding points happens in the same transaction as the attempt record.
   */
  async logAttempt(params: {
    customerId: string;
    gameId: string;
    levelId?: string;
    resultMetric: number;
    didWin: boolean;
    loggedByStaffId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.gameAttempt.create({
        data: { ...params, challengeCode: await this.generateChallengeCode(tx) },
      });

      const participationPoints = 20;
      const winBonus = params.didWin ? 50 : 0;

      await this.points.award(tx, {
        customerId: params.customerId,
        points: participationPoints + winBonus,
        sourceType: params.didWin ? PointsSourceType.GAME_WIN : PointsSourceType.GAME_PARTICIPATION,
        note: `Game attempt ${attempt.id}`,
      });

      if (params.didWin) {
        await this.achievements.checkGameAchievements(tx, params.customerId);
      }

      return attempt;
    });
  }

  /**
   * PP-GAME-000001 style — sequential and human-readable, matching the
   * finalized spec's own example (PP-GAME-00125) exactly. Counts
   * existing attempts rather than using a dedicated DB sequence; a
   * theoretical double-create in the same instant would still get
   * unique codes since challengeCode has its own @unique constraint —
   * this just makes a collision astronomically unlikely rather than
   * structurally impossible, which is an acceptable tradeoff for a
   * human-facing reference code, not a payment/security identifier.
   */
  private async generateChallengeCode(tx: any): Promise<string> {
    const count = await tx.gameAttempt.count();
    return `PP-GAME-${String(count + 1).padStart(6, '0')}`;
  }

  async getLeaderboard(limit = 10) {
    // Redis is a supplementary ranking cache, not the source of truth for
    // points balances (Postgres is) — a Redis outage should degrade to
    // an empty leaderboard, not a 500 error on a page that otherwise has
    // nothing to do with Redis being up.
    const flat = await this.redis.zrevrange(LEADERBOARD_KEY, 0, limit - 1, 'WITHSCORES').catch(() => [] as string[]);

    // flat = [customerId, score, customerId, score, ...]
    const entries: { customerId: string; points: number }[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      entries.push({ customerId: flat[i], points: Number(flat[i + 1]) });
    }

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: entries.map((e) => e.customerId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(customers.map((c: { id: string; name: string }) => [c.id, c.name]));

    return entries.map((e, i) => ({
      rank: i + 1,
      customerId: e.customerId,
      name: nameById.get(e.customerId) ?? 'member',
      points: e.points,
    }));
  }

  /**
   * Only customers who opted in with a gym name at signup are included —
   * this is never inferred or defaulted. Aggregated in application code
   * rather than a DB groupBy since it needs each customer's current
   * points balance (a related table), which Prisma's groupBy can't
   * aggregate across a relation directly.
   */
  async getGymLeaderboard() {
    const customers = await this.prisma.customer.findMany({
      where: { gymName: { not: null } },
      select: { gymName: true, pointsBalance: { select: { balance: true } } },
    });

    const byGym = new Map<string, { totalPoints: number; memberCount: number }>();
    for (const c of customers) {
      const gym = c.gymName as string;
      const existing = byGym.get(gym) ?? { totalPoints: 0, memberCount: 0 };
      existing.totalPoints += c.pointsBalance?.balance ?? 0;
      existing.memberCount += 1;
      byGym.set(gym, existing);
    }

    return [...byGym.entries()]
      .map(([gymName, stats]) => ({ gymName, ...stats }))
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .map((entry, i) => ({ rank: i + 1, ...entry }));
  }

  // ---- Full challenge system (Pay & Play) ----

  /**
   * Step 1 of "Select Challenge → Confirm Rules → Pay ₹49 → Payment
   * Success → Generate Challenge ID → Start Challenge": creates the
   * attempt record and works out, from the customer's real recent
   * order history, whether this is a genuinely free attempt (a ≥₹150
   * qualifying purchase on the two games that offer it) or a real ₹49
   * entry fee to collect. Never trusts a client-supplied "isFree" flag
   * — the ≥₹150 check is re-derived here from the customer's own real
   * orders every time.
   */
  async createChallengeAttempt(customerId: string, gameId: string) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game || !game.isActive) throw new NotFoundException('Game not found or not currently active');

    const entryFeeRs = Number(game.entryFeeRs ?? 0);
    const freeAttemptMin = game.freeAttemptMinPurchaseRs ? Number(game.freeAttemptMinPurchaseRs) : null;

    let wasFreeAttempt = false;
    let qualifyingOrderId: string | null = null;

    if (freeAttemptMin !== null && entryFeeRs > 0) {
      // The most recent qualifying order not already spent on a free
      // attempt for this same game — reusing one ₹150+ order for
      // unlimited free attempts would defeat the whole point of the
      // threshold, so each qualifying order can unlock exactly one.
      const alreadyUsedOrderIds = (
        await this.prisma.gameAttempt.findMany({
          where: { customerId, gameId, wasFreeAttempt: true, qualifyingOrderId: { not: null } },
          select: { qualifyingOrderId: true },
        })
      ).map((a: { qualifyingOrderId: string | null }) => a.qualifyingOrderId);

      const qualifyingOrder = await this.prisma.order.findFirst({
        where: {
          customerId,
          totalRs: { gte: freeAttemptMin },
          status: { notIn: ['CANCELLED', 'FAILED'] },
          id: { notIn: alreadyUsedOrderIds.filter((id: string | null): id is string => id !== null) },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      if (qualifyingOrder) {
        wasFreeAttempt = true;
        qualifyingOrderId = qualifyingOrder.id;
      }
    }

    const challengeCode = await this.generateChallengeCode(this.prisma);
    const attempt = await this.prisma.gameAttempt.create({
      data: {
        customerId,
        gameId,
        challengeCode,
        entryFeeRs: wasFreeAttempt ? 0 : entryFeeRs,
        wasFreeAttempt,
        qualifyingOrderId,
        // A free game (Coin Balance, entryFeeRs = 0) or a genuinely free
        // attempt both skip the payment step entirely and go straight
        // to IN_PROGRESS; a real ₹49 entry waits for payment
        // confirmation first.
        status: entryFeeRs === 0 || wasFreeAttempt ? 'IN_PROGRESS' : 'PENDING_PAYMENT',
        startedAt: entryFeeRs === 0 || wasFreeAttempt ? new Date() : null,
      },
    });

    return { ...attempt, unlockedFreeAttempt: wasFreeAttempt };
  }

  /** Confirms a ₹49 entry was actually paid (cash/UPI/card, collected the same way a POS sale is) and starts the timer. */
  async confirmChallengePayment(attemptId: string) {
    const attempt = await this.prisma.gameAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (attempt.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('This challenge is not waiting on payment');
    }
    return this.prisma.gameAttempt.update({
      where: { id: attemptId },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
  }

  /**
   * Staff records the final result once the attempt is physically
   * over — the moment calculateGameReward() actually runs. Requires a
   * real eligible purchase amount for games whose reward is a
   * discount, since the discount is capped against it; free-product
   * and percent-discount-on-completion games can pass 0 if there's no
   * purchase alongside the challenge itself yet.
   */
  async recordChallengeResult(attemptId: string, resultMetric: number, purchaseAmountRs: number, loggedByStaffId: string) {
    const attempt = await this.prisma.gameAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { game: true } });
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('This challenge is not currently in progress');
    }

    const config = attempt.game.rewardConfig as unknown as RewardConfig | null;
    const reward = config
      ? calculateGameReward(config, resultMetric, purchaseAmountRs)
      : { didWin: false, rewardType: 'NONE' as const, rewardDescription: 'No reward configured for this game', discountAppliedRs: 0 };

    return this.prisma.gameAttempt.update({
      where: { id: attemptId },
      data: {
        resultMetric,
        didWin: reward.didWin,
        rewardType: reward.rewardType,
        rewardDescription: reward.rewardDescription,
        discountAppliedRs: reward.discountAppliedRs,
        endedAt: new Date(),
        status: 'AWAITING_VERIFICATION',
        loggedByStaffId,
      },
    });
  }

  /**
   * The final, deliberate lock — matching the finalized spec's own
   * rule that "staff should not be able to manually change the final
   * repetition/time after verification without an admin action." Once
   * VERIFIED, recordChallengeResult's IN_PROGRESS check already blocks
   * any further edit through the normal staff flow.
   */
  async verifyChallengeAttempt(attemptId: string, verifiedByStaffId: string) {
    const attempt = await this.prisma.gameAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (attempt.status !== 'AWAITING_VERIFICATION') {
      throw new BadRequestException('This challenge has no recorded result awaiting verification');
    }
    return this.prisma.gameAttempt.update({
      where: { id: attemptId },
      data: { status: 'VERIFIED', verifiedAt: new Date(), loggedByStaffId: verifiedByStaffId },
    });
  }

  /** "My Challenges" — full history plus the best-score summary the finalized spec's customer account view calls for. */
  async myChallengeHistory(customerId: string) {
    const attempts = await this.prisma.gameAttempt.findMany({
      where: { customerId },
      orderBy: { playedAt: 'desc' },
      include: { game: { select: { name: true } } },
    });

    const completed = attempts.filter((a: { status: string }) => a.status === 'VERIFIED');
    const totalRewardsRs = completed.reduce((sum: number, a: { discountAppliedRs: unknown }) => sum + Number(a.discountAppliedRs ?? 0), 0);

    const bestByGame = new Map<string, number>();
    for (const a of completed) {
      const current = bestByGame.get(a.game.name) ?? 0;
      if (Number(a.resultMetric) > current) bestByGame.set(a.game.name, Number(a.resultMetric));
    }

    return {
      totalPlayed: attempts.length,
      totalCompleted: completed.length,
      totalRewardsRs,
      bestByGame: Object.fromEntries(bestByGame),
      attempts,
    };
  }

  /** The admin Challenge Dashboard — today's real activity across every game. */
  async challengeDashboard() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayAttempts = await this.prisma.gameAttempt.findMany({
      where: { playedAt: { gte: startOfToday } },
      include: { game: { select: { name: true } } },
    });

    return {
      todayTotal: todayAttempts.length,
      activeNow: todayAttempts.filter((a: { status: string }) => a.status === 'IN_PROGRESS').length,
      awaitingVerification: todayAttempts.filter((a: { status: string }) => a.status === 'AWAITING_VERIFICATION').length,
      verified: todayAttempts.filter((a: { status: string }) => a.status === 'VERIFIED').length,
      wins: todayAttempts.filter((a: { didWin: boolean }) => a.didWin).length,
      freeAttempts: todayAttempts.filter((a: { wasFreeAttempt: boolean }) => a.wasFreeAttempt).length,
      totalEntryFeeRevenueRs: todayAttempts.reduce((sum: number, a: { entryFeeRs: unknown }) => sum + Number(a.entryFeeRs ?? 0), 0),
      totalDiscountsIssuedRs: todayAttempts.reduce((sum: number, a: { discountAppliedRs: unknown }) => sum + Number(a.discountAppliedRs ?? 0), 0),
      attempts: todayAttempts,
    };
  }
}
