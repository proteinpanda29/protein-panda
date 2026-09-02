import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupportTicketsService } from './support-tickets.service';

function makeHarness() {
  const prisma: any = {
    supportTicket: { create: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    supportTicketMessage: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn().mockImplementation((cb: any) => cb(prisma));
  const notifications = { notifyCustomer: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new SupportTicketsService(prisma, notifications);
  return { service, prisma, notifications };
}

describe('SupportTicketsService.createTicket', () => {
  it('rejects a missing subject', async () => {
    const { service } = makeHarness();
    await expect(service.createTicket('cust-1', '', 'body text')).rejects.toThrow(/subject is required/);
  });

  it('rejects a missing body', async () => {
    const { service } = makeHarness();
    await expect(service.createTicket('cust-1', 'Subject', '  ')).rejects.toThrow(/message is required/);
  });

  it('creates the ticket with its first message in one call', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.create.mockResolvedValue({});

    await service.createTicket('cust-1', '  Missing item  ', '  My order was missing a shake  ', 'order-1');

    expect(prisma.supportTicket.create).toHaveBeenCalledWith({
      data: {
        customerId: 'cust-1',
        subject: 'Missing item',
        orderId: 'order-1',
        messages: { create: { isFromAdmin: false, body: 'My order was missing a shake' } },
      },
      include: { messages: true },
    });
  });
});

describe('SupportTicketsService.getTicketForCustomer', () => {
  it('rejects fetching a ticket that belongs to a different customer', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-OTHER' });

    await expect(service.getTicketForCustomer('cust-1', 't1')).rejects.toThrow(ForbiddenException);
  });
});

describe('SupportTicketsService.replyAsCustomer', () => {
  it('rejects an empty reply', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-1', status: 'OPEN' });

    await expect(service.replyAsCustomer('cust-1', 't1', '')).rejects.toThrow(BadRequestException);
  });

  it('rejects replying to a ticket that is not theirs', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-OTHER', status: 'OPEN' });

    await expect(service.replyAsCustomer('cust-1', 't1', 'hello')).rejects.toThrow(ForbiddenException);
  });

  it('reopens a RESOLVED ticket when the customer replies', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-1', status: 'RESOLVED' });
    prisma.supportTicketMessage.create.mockResolvedValue({});

    await service.replyAsCustomer('cust-1', 't1', 'This is still broken');

    expect(prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'OPEN' } });
  });

  it('reopens a CLOSED ticket when the customer replies', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-1', status: 'CLOSED' });
    prisma.supportTicketMessage.create.mockResolvedValue({});

    await service.replyAsCustomer('cust-1', 't1', 'Reopening this');

    expect(prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'OPEN' } });
  });

  it('does not change status when replying to an already-OPEN ticket', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-1', status: 'OPEN' });
    prisma.supportTicketMessage.create.mockResolvedValue({});

    await service.replyAsCustomer('cust-1', 't1', 'Following up');

    expect(prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: {} });
  });

  it('creates the message with isFromAdmin false', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-1', status: 'OPEN' });
    prisma.supportTicketMessage.create.mockResolvedValue({});

    await service.replyAsCustomer('cust-1', 't1', 'My message');

    expect(prisma.supportTicketMessage.create).toHaveBeenCalledWith({
      data: { ticketId: 't1', isFromAdmin: false, body: 'My message' },
    });
  });
});

describe('SupportTicketsService.replyAsAdmin', () => {
  it('advances OPEN to IN_PROGRESS on the first admin reply', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-1', status: 'OPEN', subject: 'Missing item' });
    prisma.supportTicketMessage.create.mockResolvedValue({});

    await service.replyAsAdmin('admin-user-1', 't1', 'Looking into this now');

    expect(prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'IN_PROGRESS' } });
  });

  it('does not touch status when the ticket is already IN_PROGRESS', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-1', status: 'IN_PROGRESS', subject: 'X' });
    prisma.supportTicketMessage.create.mockResolvedValue({});

    await service.replyAsAdmin('admin-user-1', 't1', 'Update');

    expect(prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: {} });
  });

  it('records which admin replied', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-1', status: 'OPEN', subject: 'X' });
    prisma.supportTicketMessage.create.mockResolvedValue({});

    await service.replyAsAdmin('admin-user-42', 't1', 'Reply body');

    expect(prisma.supportTicketMessage.create).toHaveBeenCalledWith({
      data: { ticketId: 't1', isFromAdmin: true, repliedByUserId: 'admin-user-42', body: 'Reply body' },
    });
  });

  it('notifies the customer via the notification center — a real integration, not a silo', async () => {
    const { service, prisma, notifications } = makeHarness();
    prisma.supportTicket.findUniqueOrThrow.mockResolvedValue({ id: 't1', customerId: 'cust-1', status: 'OPEN', subject: 'Missing item' });
    prisma.supportTicketMessage.create.mockResolvedValue({});

    await service.replyAsAdmin('admin-user-1', 't1', 'We are sending a replacement');

    expect(notifications.notifyCustomer).toHaveBeenCalledWith(
      'cust-1',
      'SUPPORT_REPLY',
      'Reply: Missing item',
      'We are sending a replacement',
    );
  });
});

describe('SupportTicketsService.updateStatus', () => {
  it('rejects an invalid status value', async () => {
    const { service } = makeHarness();
    await expect(service.updateStatus('t1', 'BOGUS')).rejects.toThrow(/Invalid status/);
  });

  it('accepts a valid status', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.update.mockResolvedValue({});

    await service.updateStatus('t1', 'RESOLVED');

    expect(prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'RESOLVED' } });
  });
});

describe('SupportTicketsService.listAllTickets', () => {
  it('filters by status when provided', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findMany.mockResolvedValue([]);

    await service.listAllTickets('OPEN');

    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'OPEN' } }),
    );
  });

  it('returns everything when no status filter is given', async () => {
    const { service, prisma } = makeHarness();
    prisma.supportTicket.findMany.mockResolvedValue([]);

    await service.listAllTickets();

    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });
});
