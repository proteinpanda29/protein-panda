import { BadRequestException } from '@nestjs/common';
import { StoreOperationsService } from './store-operations.service';

function makeHarness() {
  const prisma = {
    storeChecklistItem: { findMany: jest.fn().mockResolvedValue([]) },
    storeChecklistLog: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
    cashShift: { findFirst: jest.fn().mockResolvedValue(null) },
    businessDay: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
  } as any;
  const service = new StoreOperationsService(prisma);
  return { service, prisma };
}

describe('StoreOperationsService.submitLog', () => {
  it('rejects a submission with no entries at all', async () => {
    const { service } = makeHarness();
    await expect(service.submitLog('user-1', 'OPENING', [])).rejects.toThrow(BadRequestException);
  });

  it('rejects a submission referencing a checklist item that does not actually exist', async () => {
    const { service, prisma } = makeHarness();
    prisma.storeChecklistItem.findMany.mockResolvedValue([{ id: 'item-1' }]);

    await expect(service.submitLog('user-1', 'OPENING', [{ checklistItemId: 'item-UNKNOWN' }])).rejects.toThrow(/Unknown checklist item/);
  });

  it('records a valid submission with the real submitting user', async () => {
    const { service, prisma } = makeHarness();
    prisma.storeChecklistItem.findMany.mockResolvedValue([{ id: 'item-1' }]);

    await service.submitLog('user-1', 'CLOSING', [{ checklistItemId: 'item-1', isCompleted: true }]);

    expect(prisma.storeChecklistLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'CLOSING', submittedByUserId: 'user-1' }) }),
    );
  });
});

describe('StoreOperationsService.closeBusinessDay', () => {
  it('refuses to close when the closing checklist was never submitted today', async () => {
    const { service, prisma } = makeHarness();
    prisma.storeChecklistLog.findFirst.mockResolvedValue(null);
    prisma.cashShift.findFirst.mockResolvedValue({ status: 'CLOSED' });

    await expect(service.closeBusinessDay('user-1')).rejects.toThrow(/closing checklist/);
  });

  it("refuses to close when today's cash shift is not actually closed", async () => {
    const { service, prisma } = makeHarness();
    prisma.storeChecklistLog.findFirst.mockResolvedValue({ id: 'log-1' });
    prisma.cashShift.findFirst.mockResolvedValue({ status: 'OPEN' });

    await expect(service.closeBusinessDay('user-1')).rejects.toThrow(/cash shift must be closed/);
  });

  it('refuses to close a day that has already been closed', async () => {
    const { service, prisma } = makeHarness();
    prisma.storeChecklistLog.findFirst.mockResolvedValue({ id: 'log-1' });
    prisma.cashShift.findFirst.mockResolvedValue({ status: 'CLOSED' });
    prisma.businessDay.findUnique.mockResolvedValue({ closedAt: new Date() });

    await expect(service.closeBusinessDay('user-1')).rejects.toThrow(/already been closed/);
  });

  it('closes the day for real once the closing checklist is submitted and cash is closed', async () => {
    const { service, prisma } = makeHarness();
    prisma.storeChecklistLog.findFirst.mockResolvedValue({ id: 'log-1' });
    prisma.cashShift.findFirst.mockResolvedValue({ status: 'CLOSED' });

    await service.closeBusinessDay('user-1');

    const call = prisma.businessDay.upsert.mock.calls[0][0];
    expect(call.create.closedByUserId).toBe('user-1');
    expect(call.update.closedByUserId).toBe('user-1');
  });
});

describe('StoreOperationsService.getTodayStatus', () => {
  it('reports not ready to close when any one of the three real conditions is missing', async () => {
    const { service, prisma } = makeHarness();
    prisma.storeChecklistLog.findFirst.mockResolvedValue({ id: 'log-1' }); // closing done
    prisma.cashShift.findFirst.mockResolvedValue({ status: 'OPEN' }); // but cash NOT closed

    const result = await service.getTodayStatus();

    expect(result.readyToClose).toBe(false);
  });

  it('reports ready to close only when checklist done, cash closed, and not already closed', async () => {
    const { service, prisma } = makeHarness();
    prisma.storeChecklistLog.findFirst.mockResolvedValue({ id: 'log-1' });
    prisma.cashShift.findFirst.mockResolvedValue({ status: 'CLOSED' });
    prisma.businessDay.findUnique.mockResolvedValue(null);

    const result = await service.getTodayStatus();

    expect(result.readyToClose).toBe(true);
  });
});
