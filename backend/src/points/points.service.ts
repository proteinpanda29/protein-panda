import { Injectable } from '@nestjs/common';
import { PointsSourceType, PrismaClient } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const LEADERBOARD_KEY = 'leaderboard:monthly:points';

@Injectable()
export class PointsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /**
   * Writes a ledger entry and updates the running balance atomically.
   * Pass a transaction client (tx) when called from within another
   * transaction (e.g. order completion) so points/streak/nutrition
   * stay consistent with the order itself.
   *
   * The Redis leaderboard sorted set is refreshed for every points source
   * (purchases, games, streak bonuses, goal completions, referrals) —
   * not just games — so the leaderboard reflects total points overall.
   */
  async award(
    tx: Tx,
    params: { customerId: string; points: number; sourceType: PointsSourceType; orderId?: string; note?: string },
  ) {
    const { customerId, points, sourceType, orderId, note } = params;

    await tx.pointsLedgerEntry.create({
      data: { customerId, points, sourceType, orderId, note },
    });

    const balance = await tx.pointsBalance.upsert({
      where: { customerId },
      create: { customerId, balance: points },
      update: { balance: { increment: points } },
    });

    // Fire-and-forget from the DB transaction's perspective — Redis isn't
    // transactional with Postgres, so a leaderboard write failure shouldn't
    // roll back the points award itself.
    this.redis.zadd(LEADERBOARD_KEY, balance.balance, customerId).catch(() => undefined);
  }

  async getBalance(customerId: string) {
    const balance = await this.prisma.pointsBalance.findUnique({ where: { customerId } });
    return balance?.balance ?? 0;
  }
}
