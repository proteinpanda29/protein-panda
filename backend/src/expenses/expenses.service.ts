import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface RecordExpenseInput {
  category: 'PURCHASE' | 'OPERATING' | 'STAFF' | 'DELIVERY' | 'MARKETING' | 'EQUIPMENT' | 'OTHER';
  amountRs: number;
  description: string;
  expenseDate?: string;
  paymentMethod?: string;
}

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async recordExpense(userId: string, input: RecordExpenseInput) {
    if (input.amountRs <= 0) throw new BadRequestException('Expense amount must be positive');
    if (!input.description?.trim()) throw new BadRequestException('A description is required');

    return this.prisma.expense.create({
      data: {
        category: input.category,
        amountRs: input.amountRs,
        description: input.description.trim(),
        expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
        paymentMethod: input.paymentMethod,
        createdByUserId: userId,
      },
    });
  }

  async listExpenses(params: { category?: string; dateFrom?: string; dateTo?: string }) {
    return this.prisma.expense.findMany({
      where: {
        ...(params.category ? { category: params.category as any } : {}),
        ...(params.dateFrom || params.dateTo
          ? {
              expenseDate: {
                ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
                ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
              },
            }
          : {}),
      },
      orderBy: { expenseDate: 'desc' },
      include: { createdByUser: { select: { staff: { select: { name: true } } } } },
    });
  }

  async deleteExpense(id: string) {
    return this.prisma.expense.delete({ where: { id } });
  }

  /**
   * The real summary the Finance dashboard needs — total spend broken
   * down by category for a given window, computed from actual Expense
   * rows rather than estimated.
   */
  async getExpenseSummary(dateFrom: string, dateTo: string) {
    const expenses = await this.prisma.expense.findMany({
      where: { expenseDate: { gte: new Date(dateFrom), lte: new Date(dateTo) } },
      select: { category: true, amountRs: true },
    });

    const byCategory: Record<string, number> = {};
    let totalRs = 0;
    for (const e of expenses) {
      const amount = Number(e.amountRs);
      byCategory[e.category] = (byCategory[e.category] ?? 0) + amount;
      totalRs += amount;
    }

    return { totalRs, byCategory };
  }
}
