import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface SubmitLogEntryInput {
  checklistItemId: string;
  isCompleted?: boolean;
  note?: string;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class StoreOperationsService {
  constructor(private prisma: PrismaService) {}

  async listChecklistItems(type: 'OPENING' | 'CLOSING') {
    return this.prisma.storeChecklistItem.findMany({
      where: { type, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async submitLog(userId: string, type: 'OPENING' | 'CLOSING', entries: SubmitLogEntryInput[]) {
    if (!entries?.length) throw new BadRequestException('At least one checklist entry is required');

    const itemIds = entries.map((e) => e.checklistItemId);
    const items = await this.prisma.storeChecklistItem.findMany({ where: { id: { in: itemIds } } });
    const itemIdSet = new Set(items.map((i: { id: string }) => i.id));
    for (const entry of entries) {
      if (!itemIdSet.has(entry.checklistItemId)) throw new BadRequestException(`Unknown checklist item: ${entry.checklistItemId}`);
    }

    return this.prisma.storeChecklistLog.create({
      data: {
        type,
        submittedByUserId: userId,
        entries: {
          create: entries.map((entry) => ({
            checklistItemId: entry.checklistItemId,
            isCompleted: entry.isCompleted ?? true,
            note: entry.note,
          })),
        },
      },
      include: { entries: { include: { checklistItem: true } } },
    });
  }

  /**
   * Today's status for both checklists in one call — what the "Store
   * Operations" dashboard actually needs: has opening been done, has
   * closing been done, and are we clear to close the business day.
   */
  async getTodayStatus() {
    const [openingLog, closingLog, cashShift, businessDay] = await Promise.all([
      this.prisma.storeChecklistLog.findFirst({ where: { type: 'OPENING', logDate: { gte: startOfToday() } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.storeChecklistLog.findFirst({ where: { type: 'CLOSING', logDate: { gte: startOfToday() } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.cashShift.findFirst({ where: { openedAt: { gte: startOfToday() } }, orderBy: { openedAt: 'desc' } }),
      this.prisma.businessDay.findUnique({ where: { date: startOfToday() } }),
    ]);

    return {
      openingCompleted: !!openingLog,
      closingCompleted: !!closingLog,
      cashShiftClosed: cashShift?.status === 'CLOSED',
      isBusinessDayClosed: !!businessDay?.closedAt,
      readyToClose: !!closingLog && cashShift?.status === 'CLOSED' && !businessDay?.closedAt,
    };
  }

  /**
   * The actual lock — refuses to close unless the closing checklist is
   * genuinely submitted AND the day's cash shift is genuinely closed
   * (reusing the real cash-reconciliation flow that already exists,
   * not a separate parallel cash check). Once closed, this is the row
   * a future "is today locked" check would look for before allowing a
   * sensitive edit — wiring that into every relevant action across the
   * app is real, separate follow-up work, not done as part of this.
   */
  async closeBusinessDay(userId: string) {
    const status = await this.getTodayStatus();
    if (status.isBusinessDayClosed) throw new BadRequestException('Today has already been closed');
    if (!status.closingCompleted) throw new BadRequestException('Submit the closing checklist before closing the business day');
    if (!status.cashShiftClosed) throw new BadRequestException("Today's cash shift must be closed before closing the business day");

    return this.prisma.businessDay.upsert({
      where: { date: startOfToday() },
      create: { date: startOfToday(), closedAt: new Date(), closedByUserId: userId },
      update: { closedAt: new Date(), closedByUserId: userId },
    });
  }
}
