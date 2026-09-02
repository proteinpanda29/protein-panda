import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PointsSourceType } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { PointsService } from '../points/points.service';

@Injectable()
export class RewardsService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
  ) {}

  async listAvailable() {
    return this.prisma.reward.findMany({ where: { isActive: true }, orderBy: { pointsCost: 'asc' } });
  }

  async redeem(customerId: string, rewardId: string) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.reward.findUniqueOrThrow({ where: { id: rewardId } });
      const balance = await tx.pointsBalance.findUnique({ where: { customerId } });

      if (!balance || balance.balance < reward.pointsCost) {
        throw new BadRequestException('Not enough points for this reward');
      }

      await this.points.award(tx, {
        customerId,
        points: -reward.pointsCost,
        sourceType: PointsSourceType.REDEMPTION,
        note: `Redeemed ${reward.name}`,
      });

      return tx.rewardRedemption.create({
        data: { customerId, rewardId, pointsSpent: reward.pointsCost },
        include: { reward: true },
      });
    });
  }

  async myRedemptions(customerId: string) {
    return this.prisma.rewardRedemption.findMany({
      where: { customerId },
      orderBy: { redeemedAt: 'desc' },
      include: { reward: true },
    });
  }

  /** Ownership check reused by the PDF voucher endpoint — a customer can never download another customer's redemption voucher. */
  async assertOwnsRedemption(customerId: string, redemptionId: string) {
    const redemption = await this.prisma.rewardRedemption.findUniqueOrThrow({ where: { id: redemptionId } });
    if (redemption.customerId !== customerId) {
      throw new ForbiddenException('This redemption does not belong to you');
    }
    return redemption;
  }
}
