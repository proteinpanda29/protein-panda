import { BadRequestException } from '@nestjs/common';
import { FoodSafetyService } from './food-safety.service';

function makeHarness() {
  const prisma: any = {
    foodSafetyChecklistItem: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    foodSafetyLog: { create: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn(), count: jest.fn() },
  };
  const service = new FoodSafetyService(prisma);
  return { service, prisma };
}

describe('FoodSafetyService.createChecklistItem', () => {
  it('rejects a missing label', async () => {
    const { service } = makeHarness();
    await expect(service.createChecklistItem({ label: '', category: 'OPENING' })).rejects.toThrow(/Label is required/);
  });

  it('creates an item with a trimmed label', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyChecklistItem.create.mockResolvedValue({});

    await service.createChecklistItem({ label: '  Fridge temp check  ', category: 'TEMPERATURE', requiresTemperature: true, minTempC: 0, maxTempC: 5 });

    expect(prisma.foodSafetyChecklistItem.create).toHaveBeenCalledWith({
      data: {
        label: 'Fridge temp check',
        category: 'TEMPERATURE',
        sortOrder: 0,
        requiresTemperature: true,
        minTempC: 0,
        maxTempC: 5,
      },
    });
  });
});

describe('FoodSafetyService.submitLog', () => {
  it('rejects a submission with no entries', async () => {
    const { service } = makeHarness();
    await expect(service.submitLog('user-1', { entries: [] })).rejects.toThrow(BadRequestException);
  });

  it('rejects an entry referencing a checklist item that does not exist', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyChecklistItem.findMany.mockResolvedValue([]);

    await expect(
      service.submitLog('user-1', { entries: [{ checklistItemId: 'missing-item', isCompleted: true }] }),
    ).rejects.toThrow(/Unknown checklist item/);
  });

  it('rejects a temperature-requiring item submitted without a temperature reading', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyChecklistItem.findMany.mockResolvedValue([
      { id: 'item-fridge', label: 'Fridge temp', requiresTemperature: true, minTempC: 0, maxTempC: 5 },
    ]);

    await expect(
      service.submitLog('user-1', { entries: [{ checklistItemId: 'item-fridge', isCompleted: true }] }),
    ).rejects.toThrow(/requires a temperature reading/);
  });

  it('accepts a temperature-requiring item with a reading, even without isCompleted set', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyChecklistItem.findMany.mockResolvedValue([
      { id: 'item-fridge', label: 'Fridge temp', requiresTemperature: true, minTempC: 0, maxTempC: 5 },
    ]);
    prisma.foodSafetyLog.create.mockResolvedValue({});

    await expect(
      service.submitLog('user-1', { entries: [{ checklistItemId: 'item-fridge', temperatureC: 3 }] }),
    ).resolves.toBeDefined();
  });

  it('flags a reading below the minimum as out of range', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyChecklistItem.findMany.mockResolvedValue([
      { id: 'item-fridge', label: 'Fridge temp', requiresTemperature: true, minTempC: 0, maxTempC: 5 },
    ]);
    prisma.foodSafetyLog.create.mockResolvedValue({});

    await service.submitLog('user-1', { entries: [{ checklistItemId: 'item-fridge', temperatureC: -2 }] });

    const createArg = prisma.foodSafetyLog.create.mock.calls[0][0];
    expect(createArg.data.entries.create[0].isOutOfRange).toBe(true);
  });

  it('flags a reading above the maximum as out of range', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyChecklistItem.findMany.mockResolvedValue([
      { id: 'item-fridge', label: 'Fridge temp', requiresTemperature: true, minTempC: 0, maxTempC: 5 },
    ]);
    prisma.foodSafetyLog.create.mockResolvedValue({});

    await service.submitLog('user-1', { entries: [{ checklistItemId: 'item-fridge', temperatureC: 9 }] });

    const createArg = prisma.foodSafetyLog.create.mock.calls[0][0];
    expect(createArg.data.entries.create[0].isOutOfRange).toBe(true);
  });

  it('does not flag a reading within range', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyChecklistItem.findMany.mockResolvedValue([
      { id: 'item-fridge', label: 'Fridge temp', requiresTemperature: true, minTempC: 0, maxTempC: 5 },
    ]);
    prisma.foodSafetyLog.create.mockResolvedValue({});

    await service.submitLog('user-1', { entries: [{ checklistItemId: 'item-fridge', temperatureC: 3 }] });

    const createArg = prisma.foodSafetyLog.create.mock.calls[0][0];
    expect(createArg.data.entries.create[0].isOutOfRange).toBe(false);
  });

  it('attributes the log to the submitting user', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyChecklistItem.findMany.mockResolvedValue([
      { id: 'item-clean', label: 'Cleaning done', requiresTemperature: false, minTempC: null, maxTempC: null },
    ]);
    prisma.foodSafetyLog.create.mockResolvedValue({});

    await service.submitLog('user-42', { shiftLabel: 'Opening', entries: [{ checklistItemId: 'item-clean', isCompleted: true }] });

    expect(prisma.foodSafetyLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submittedByUserId: 'user-42', shiftLabel: 'Opening' }) }),
    );
  });

  it('defaults isCompleted to true when not explicitly provided for a non-temperature item', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyChecklistItem.findMany.mockResolvedValue([
      { id: 'item-clean', label: 'Cleaning done', requiresTemperature: false, minTempC: null, maxTempC: null },
    ]);
    prisma.foodSafetyLog.create.mockResolvedValue({});

    await service.submitLog('user-1', { entries: [{ checklistItemId: 'item-clean' }] });

    const createArg = prisma.foodSafetyLog.create.mock.calls[0][0];
    expect(createArg.data.entries.create[0].isCompleted).toBe(true);
  });
});

describe('FoodSafetyService.hasSubmittedToday', () => {
  it('returns true when at least one log exists for today', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyLog.count.mockResolvedValue(1);

    await expect(service.hasSubmittedToday()).resolves.toBe(true);
  });

  it('returns false when no log exists for today', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyLog.count.mockResolvedValue(0);

    await expect(service.hasSubmittedToday()).resolves.toBe(false);
  });

  it('filters by shift label when provided', async () => {
    const { service, prisma } = makeHarness();
    prisma.foodSafetyLog.count.mockResolvedValue(0);

    await service.hasSubmittedToday('Closing');

    expect(prisma.foodSafetyLog.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ shiftLabel: 'Closing' }) }),
    );
  });
});
