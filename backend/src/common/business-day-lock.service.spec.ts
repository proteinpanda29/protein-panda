import { ForbiddenException } from '@nestjs/common';
import { BusinessDayLockService } from './business-day-lock.service';

function makeHarness(businessDay: any = null) {
  const prisma = { businessDay: { findUnique: jest.fn().mockResolvedValue(businessDay) } } as any;
  const service = new BusinessDayLockService(prisma);
  return { service, prisma };
}

describe('BusinessDayLockService.isTodayClosed', () => {
  it('is false when no BusinessDay row exists for today at all', async () => {
    const { service } = makeHarness(null);
    expect(await service.isTodayClosed()).toBe(false);
  });

  it('is false when a row exists but was never actually closed', async () => {
    const { service } = makeHarness({ closedAt: null });
    expect(await service.isTodayClosed()).toBe(false);
  });

  it('is true once the day has genuinely been closed', async () => {
    const { service } = makeHarness({ closedAt: new Date() });
    expect(await service.isTodayClosed()).toBe(true);
  });
});

describe('BusinessDayLockService.assertNotClosed', () => {
  it('does nothing (no throw) when today is not closed', async () => {
    const { service } = makeHarness(null);
    await expect(service.assertNotClosed('changing a price')).resolves.toBeUndefined();
  });

  it('throws a clear, actionable error naming the specific action once today is closed', async () => {
    const { service } = makeHarness({ closedAt: new Date() });
    await expect(service.assertNotClosed('changing a price')).rejects.toThrow(ForbiddenException);
    await expect(service.assertNotClosed('changing a price')).rejects.toThrow(/changing a price/);
  });
});
