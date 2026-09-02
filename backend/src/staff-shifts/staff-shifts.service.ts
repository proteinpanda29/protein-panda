import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class StaffShiftsService {
  constructor(private prisma: PrismaService) {}

  async clockIn(userId: string) {
    const existing = await this.prisma.staffShift.findFirst({
      where: { userId, clockedOutAt: null },
    });
    if (existing) throw new BadRequestException('Already clocked in — clock out first');

    return this.prisma.staffShift.create({ data: { userId } });
  }

  async clockOut(userId: string, note?: string) {
    const open = await this.prisma.staffShift.findFirst({
      where: { userId, clockedOutAt: null },
    });
    if (!open) throw new BadRequestException('Not currently clocked in');

    return this.prisma.staffShift.update({
      where: { id: open.id },
      data: { clockedOutAt: new Date(), note },
    });
  }

  /** The currently open shift for this user, if any — lets the UI show "clocked in since X" vs. a clock-in button. */
  async getCurrentShift(userId: string) {
    return this.prisma.staffShift.findFirst({ where: { userId, clockedOutAt: null } });
  }

  async listMyShifts(userId: string, take = 30) {
    return this.prisma.staffShift.findMany({
      where: { userId },
      orderBy: { clockedInAt: 'desc' },
      take,
    });
  }

  /** Every staff member's shifts, newest first — for admin oversight/payroll, not scoped to one user. */
  async listAllShifts(params: { dateFrom?: string; dateTo?: string } = {}) {
    return this.prisma.staffShift.findMany({
      where: {
        clockedInAt: {
          gte: params.dateFrom ? new Date(params.dateFrom) : undefined,
          lte: params.dateTo ? new Date(params.dateTo) : undefined,
        },
      },
      orderBy: { clockedInAt: 'desc' },
      take: 100,
      include: { user: { select: { role: true, staff: { select: { name: true } }, deliveryPerson: { select: { name: true } } } } },
    });
  }
}
