import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NotificationCenterService } from '../notification-center/notification-center.service';

@Injectable()
export class SupportTicketsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationCenterService,
  ) {}

  async createTicket(customerId: string, subject: string, body: string, orderId?: string) {
    if (!subject?.trim()) throw new BadRequestException('A subject is required');
    if (!body?.trim()) throw new BadRequestException('A message is required');

    return this.prisma.supportTicket.create({
      data: {
        customerId,
        subject: subject.trim(),
        orderId,
        messages: { create: { isFromAdmin: false, body: body.trim() } },
      },
      include: { messages: true },
    });
  }

  async listMyTickets(customerId: string) {
    return this.prisma.supportTicket.findMany({
      where: { customerId },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async getTicketForCustomer(customerId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (ticket.customerId !== customerId) throw new ForbiddenException('This ticket does not belong to you');
    return ticket;
  }

  /**
   * A customer reply after RESOLVED means it wasn't actually resolved —
   * reopens the ticket automatically rather than leaving it marked
   * resolved while a new unread message sits in it. An admin reply, by
   * contrast, only auto-advances OPEN to IN_PROGRESS (an admin
   * explicitly chooses RESOLVED/CLOSED separately — see updateStatus).
   */
  async replyAsCustomer(customerId: string, ticketId: string, body: string) {
    if (!body?.trim()) throw new BadRequestException('A message is required');

    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
    if (ticket.customerId !== customerId) throw new ForbiddenException('This ticket does not belong to you');

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.supportTicketMessage.create({
        data: { ticketId, isFromAdmin: false, body: body.trim() },
      });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? { status: 'OPEN' } : {},
      });
      return message;
    });
  }

  async replyAsAdmin(userId: string, ticketId: string, body: string) {
    if (!body?.trim()) throw new BadRequestException('A message is required');

    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });

    const message = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.supportTicketMessage.create({
        data: { ticketId, isFromAdmin: true, repliedByUserId: userId, body: body.trim() },
      });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: ticket.status === 'OPEN' ? { status: 'IN_PROGRESS' } : {},
      });
      return msg;
    });

    // Real integration with the notification center — the whole point
    // of building notifyCustomer() as a reusable method rather than a
    // one-off. Never blocks the reply itself if it fails.
    await this.notifications.notifyCustomer(
      ticket.customerId,
      'SUPPORT_REPLY',
      `Reply: ${ticket.subject}`,
      body.trim().slice(0, 200),
    );

    return message;
  }

  async listAllTickets(status?: string) {
    return this.prisma.supportTicket.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        customer: { select: { name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  async getTicketForAdmin(ticketId: string) {
    return this.prisma.supportTicket.findUniqueOrThrow({
      where: { id: ticketId },
      include: {
        customer: { select: { name: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { repliedByUser: { select: { staff: { select: { name: true } } } } },
        },
      },
    });
  }

  async updateStatus(ticketId: string, status: string) {
    const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    if (!validStatuses.includes(status)) throw new BadRequestException(`Invalid status: ${status}`);
    return this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: status as any } });
  }
}
