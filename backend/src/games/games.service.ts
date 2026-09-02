import { Injectable } from '@nestjs/common';
import { PointsSourceType } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { PointsService } from '../points/points.service';
import { AchievementsService } from '../achievements/achievements.service';

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
    return this.prisma.game.findMany({ where: { isActive: true }, include: { levels: true } });
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
      const attempt = await tx.gameAttempt.create({ data: params });

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
}
