import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface SubmitLogEntryInput {
  checklistItemId: string;
  isCompleted?: boolean;
  temperatureC?: number;
  note?: string;
}

@Injectable()
export class FoodSafetyService {
  constructor(private prisma: PrismaService) {}

  async listChecklistItems() {
    return this.prisma.foodSafetyChecklistItem.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async createChecklistItem(data: {
    label: string;
    category: string;
    sortOrder?: number;
    requiresTemperature?: boolean;
    minTempC?: number;
    maxTempC?: number;
  }) {
    if (!data.label?.trim()) throw new BadRequestException('Label is required');
    return this.prisma.foodSafetyChecklistItem.create({
      data: {
        label: data.label.trim(),
        category: data.category as any,
        sortOrder: data.sortOrder ?? 0,
        requiresTemperature: data.requiresTemperature ?? false,
        minTempC: data.minTempC,
        maxTempC: data.maxTempC,
      },
    });
  }

  async updateChecklistItem(
    id: string,
    data: Partial<{ label: string; sortOrder: number; isActive: boolean; minTempC: number; maxTempC: number }>,
  ) {
    return this.prisma.foodSafetyChecklistItem.update({ where: { id }, data });
  }

  /**
   * Records one shift's worth of checks in one submission. Every
   * temperature-requiring item must include a numeric reading — a
   * checkbox alone doesn't mean anything for a fridge temperature.
   * Out-of-range readings are computed here (against the item's current
   * min/max) and stored on the entry, not just flagged transiently, so
   * historical compliance queries stay accurate even if the acceptable
   * range is later changed.
   */
  async submitLog(userId: string, data: { shiftLabel?: string; entries: SubmitLogEntryInput[] }) {
    if (!data.entries?.length) throw new BadRequestException('At least one checklist entry is required');

    const itemIds = data.entries.map((e) => e.checklistItemId);
    const items: {
      id: string;
      label: string;
      requiresTemperature: boolean;
      minTempC: unknown;
      maxTempC: unknown;
    }[] = await this.prisma.foodSafetyChecklistItem.findMany({ where: { id: { in: itemIds } } });
    const itemById = new Map(items.map((i) => [i.id, i]));

    for (const entry of data.entries) {
      const item = itemById.get(entry.checklistItemId);
      if (!item) throw new BadRequestException(`Unknown checklist item: ${entry.checklistItemId}`);
      if (item.requiresTemperature && entry.temperatureC === undefined) {
        throw new BadRequestException(`"${item.label}" requires a temperature reading`);
      }
    }

    return this.prisma.foodSafetyLog.create({
      data: {
        shiftLabel: data.shiftLabel,
        submittedByUserId: userId,
        entries: {
          create: data.entries.map((entry) => {
            const item = itemById.get(entry.checklistItemId)!;
            const isOutOfRange =
              entry.temperatureC !== undefined &&
              ((item.minTempC !== null && entry.temperatureC < Number(item.minTempC)) ||
                (item.maxTempC !== null && entry.temperatureC > Number(item.maxTempC)));

            return {
              checklistItemId: entry.checklistItemId,
              isCompleted: entry.isCompleted ?? true,
              temperatureC: entry.temperatureC,
              isOutOfRange,
              note: entry.note,
            };
          }),
        },
      },
      include: { entries: { include: { checklistItem: true } } },
    });
  }

  async listLogs(params: { dateFrom?: string; dateTo?: string } = {}) {
    return this.prisma.foodSafetyLog.findMany({
      where: {
        logDate: {
          gte: params.dateFrom ? new Date(params.dateFrom) : undefined,
          lte: params.dateTo ? new Date(params.dateTo) : undefined,
        },
      },
      orderBy: { logDate: 'desc' },
      take: 60,
      include: {
        submittedByUser: { select: { staff: { select: { name: true } } } },
        entries: { include: { checklistItem: true } },
      },
    });
  }

  async getLog(id: string) {
    return this.prisma.foodSafetyLog.findUniqueOrThrow({
      where: { id },
      include: {
        submittedByUser: { select: { staff: { select: { name: true } } } },
        entries: { include: { checklistItem: true } },
      },
    });
  }

  /** Has today's checklist already been submitted for this shift? Powers a dashboard reminder. */
  async hasSubmittedToday(shiftLabel?: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const count = await this.prisma.foodSafetyLog.count({
      where: { logDate: { gte: startOfDay }, ...(shiftLabel ? { shiftLabel } : {}) },
    });
    return count > 0;
  }
}
