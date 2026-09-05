import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

const SETTINGS_ID = 'default';

export interface BusinessRules {
  loyaltyDivisorRs: number;
  loyaltyMultiplier: number;
  monthlyVisitTarget: number;
  requiredChallengesPerMonth: number;
}

@Injectable()
export class BusinessRulesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Upsert-on-read, same pattern as ShopSettings — a shop that's never
   * opened this settings screen still gets the exact defaults this
   * system always shipped with (÷10 then ×2, 15 visits, 1 challenge),
   * so nothing changes for anyone until they actually choose to
   * change it.
   */
  async getRules(): Promise<BusinessRules> {
    return this.prisma.businessRuleSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
  }

  async updateRules(data: Partial<BusinessRules>) {
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value <= 0) {
        throw new BadRequestException(`${key} must be a positive number`);
      }
    }
    return this.prisma.businessRuleSettings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
  }

  calculateLoyaltyPoints(purchaseRs: number, rules: Pick<BusinessRules, 'loyaltyDivisorRs' | 'loyaltyMultiplier'>): number {
    return Math.floor(purchaseRs / rules.loyaltyDivisorRs) * rules.loyaltyMultiplier;
  }
}
