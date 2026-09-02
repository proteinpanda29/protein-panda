import { StreaksService } from './streaks.service';

const FIXED_NOW = new Date('2026-08-16T12:00:00Z'); // a Sunday, matches "today" in the app

function makeTx(streakRecord: any) {
  return {
    streak: {
      findUnique: jest.fn().mockResolvedValue(streakRecord),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new-streak', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...streakRecord, ...data })),
    },
  } as any;
}

describe('StreaksService.recordQualifyingActivity', () => {
  let service: StreaksService;

  beforeEach(() => {
    service = new StreaksService();
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a new streak of 1 day for a first-time customer', async () => {
    const tx = makeTx(null);
    const result = await service.recordQualifyingActivity(tx, 'cust-1');

    expect(tx.streak.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerId: 'cust-1', currentStreakDays: 1, longestStreakDays: 1 }),
    });
    expect(result.currentStreakDays).toBe(1);
  });

  it('is idempotent — a second qualifying activity the same day does not increment', async () => {
    const tx = makeTx({
      customerId: 'cust-1',
      currentStreakDays: 5,
      longestStreakDays: 10,
      lastQualifyingDate: new Date('2026-08-16T03:00:00Z'), // earlier same day
    });

    const result = await service.recordQualifyingActivity(tx, 'cust-1');

    expect(tx.streak.update).not.toHaveBeenCalled();
    expect(result.currentStreakDays).toBe(5);
  });

  it('increments the streak when the last qualifying day was yesterday', async () => {
    const tx = makeTx({
      customerId: 'cust-1',
      currentStreakDays: 5,
      longestStreakDays: 10,
      lastQualifyingDate: new Date('2026-08-15T20:00:00Z'), // yesterday
    });

    const result = await service.recordQualifyingActivity(tx, 'cust-1');

    expect(tx.streak.update).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      data: expect.objectContaining({ currentStreakDays: 6, longestStreakDays: 10 }),
    });
    expect(result.currentStreakDays).toBe(6);
  });

  it('bumps longestStreakDays once currentStreakDays exceeds it', async () => {
    const tx = makeTx({
      customerId: 'cust-1',
      currentStreakDays: 9,
      longestStreakDays: 9,
      lastQualifyingDate: new Date('2026-08-15T20:00:00Z'),
    });

    const result = await service.recordQualifyingActivity(tx, 'cust-1');

    expect(result.currentStreakDays).toBe(10);
    expect(result.longestStreakDays).toBe(10);
  });

  it('resets the streak to 1 when a day was missed', async () => {
    const tx = makeTx({
      customerId: 'cust-1',
      currentStreakDays: 5,
      longestStreakDays: 10,
      lastQualifyingDate: new Date('2026-08-13T12:00:00Z'), // 3 days ago — gap
    });

    const result = await service.recordQualifyingActivity(tx, 'cust-1');

    expect(tx.streak.update).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      data: expect.objectContaining({ currentStreakDays: 1, longestStreakDays: 10 }),
    });
    expect(result.currentStreakDays).toBe(1);
    // longest streak record is preserved even though the current streak broke
    expect(result.longestStreakDays).toBe(10);
  });
});
