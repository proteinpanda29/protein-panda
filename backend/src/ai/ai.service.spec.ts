import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { AiService } from './ai.service';

function makePrisma(overrides: Partial<any> = {}) {
  return {
    customer: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        name: 'Priya',
        goal: 'MUSCLE_STRENGTH',
        dietaryPreference: 'VEG',
        dailyProteinGoalG: 140,
        allergies: [],
      }),
    },
    nutritionLog: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    shopSettings: { findUnique: jest.fn().mockResolvedValue({ businessName: 'Protein Panda' }) },
    aiSafetyFlag: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  } as any;
}

function mockFetchOk(replyText = 'Try the Chocolate Shake — 30g protein! 🐼') {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: replyText }] }),
  }) as any;
}

describe('AiService.chat — basic behavior', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, ANTHROPIC_API_KEY: 'test-key' };
  });
  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('rejects an empty messages array', async () => {
    const service = new AiService(makePrisma());
    await expect(service.chat('cust-1', [])).rejects.toThrow(BadRequestException);
  });

  it('throws if ANTHROPIC_API_KEY is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const service = new AiService(makePrisma());
    await expect(service.chat('cust-1', [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('returns the text reply from a successful API call', async () => {
    mockFetchOk('Here is a suggestion 🐼');
    const service = new AiService(makePrisma());

    const result = await service.chat('cust-1', [{ role: 'user', content: 'What has the most protein?' }]);

    expect(result).toEqual({ reply: 'Here is a suggestion 🐼' });
  });

  it('throws when the API call fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' }) as any;
    const service = new AiService(makePrisma());

    await expect(service.chat('cust-1', [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('does not log a safety flag for an ordinary nutrition question', async () => {
    mockFetchOk();
    const prisma = makePrisma();
    const service = new AiService(prisma);

    await service.chat('cust-1', [{ role: 'user', content: 'Which shake has 30g protein?' }]);

    expect(prisma.aiSafetyFlag.create).not.toHaveBeenCalled();
  });
});

describe('AiService.chat — medical risk detection', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, ANTHROPIC_API_KEY: 'test-key' };
    mockFetchOk();
  });
  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  const cases: { message: string; category: string }[] = [
    { message: 'I am pregnant, how much protein should I eat?', category: 'PREGNANCY' },
    { message: 'I have diabetes, what should my blood sugar be?', category: 'DIABETES' },
    { message: 'I have kidney disease and need a diet plan', category: 'KIDNEY_DISEASE' },
    { message: 'My doctor said I have liver disease', category: 'LIVER_DISEASE' },
    { message: 'I am on medication for my heart, is this safe?', category: 'MEDICATION' },
    { message: 'I have a severe allergy and carry an epipen', category: 'SEVERE_ALLERGY' },
    { message: 'What should I feed my 5 year old kid for protein?', category: 'CHILDREN' },
  ];

  it.each(cases)('detects $category from a message and logs a flag', async ({ message, category }) => {
    const prisma = makePrisma();
    const service = new AiService(prisma);

    await service.chat('cust-1', [{ role: 'user', content: message }]);

    expect(prisma.aiSafetyFlag.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerId: 'cust-1', categories: expect.arrayContaining([category]) }),
    });
  });

  it('truncates the stored message excerpt to 200 characters', async () => {
    const prisma = makePrisma();
    const service = new AiService(prisma);
    const longMessage = 'I am pregnant. ' + 'a'.repeat(300);

    await service.chat('cust-1', [{ role: 'user', content: longMessage }]);

    const call = prisma.aiSafetyFlag.create.mock.calls[0][0];
    expect(call.data.messageExcerpt.length).toBeLessThanOrEqual(200);
  });

  it('checks the LAST user message, not an earlier one in history', async () => {
    const prisma = makePrisma();
    const service = new AiService(prisma);

    await service.chat('cust-1', [
      { role: 'user', content: 'I am pregnant' },
      { role: 'assistant', content: 'General info here, please consult your doctor.' },
      { role: 'user', content: 'Which shake has the most protein?' },
    ]);

    expect(prisma.aiSafetyFlag.create).not.toHaveBeenCalled();
  });

  it('detects multiple categories in the same message', async () => {
    const prisma = makePrisma();
    const service = new AiService(prisma);

    await service.chat('cust-1', [{ role: 'user', content: 'I am pregnant and also diabetic' }]);

    const call = prisma.aiSafetyFlag.create.mock.calls[0][0];
    expect(call.data.categories).toEqual(expect.arrayContaining(['PREGNANCY', 'DIABETES']));
  });

  it('injects a reinforced medical-safety reminder into the system prompt when risk is detected', async () => {
    const prisma = makePrisma();
    const service = new AiService(prisma);

    await service.chat('cust-1', [{ role: 'user', content: 'I am pregnant, what should I eat?' }]);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.system).toContain('IMPORTANT');
    expect(body.system).toContain('PREGNANCY');
  });

  it('does not add the reinforced reminder block for an ordinary question', async () => {
    const prisma = makePrisma();
    const service = new AiService(prisma);

    await service.chat('cust-1', [{ role: 'user', content: 'What is on the menu today?' }]);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.system).not.toContain('IMPORTANT — the customer');
  });

  it('never blocks the chat response even if logging the safety flag fails', async () => {
    const prisma = makePrisma();
    prisma.aiSafetyFlag.create.mockRejectedValue(new Error('db down'));
    const service = new AiService(prisma);

    await expect(
      service.chat('cust-1', [{ role: 'user', content: 'I am pregnant, what should I eat?' }]),
    ).resolves.toBeDefined();
  });

  it('always includes the baseline medical-safety rule in the system prompt, even for a non-risky message', async () => {
    const prisma = makePrisma();
    const service = new AiService(prisma);

    await service.chat('cust-1', [{ role: 'user', content: 'What has the most protein?' }]);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.system).toContain('MEDICAL SAFETY');
    expect(body.system.toLowerCase()).toContain('pediatrician');
  });
});

describe('AiService.chat — white-label branding', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, ANTHROPIC_API_KEY: 'test-key' };
    mockFetchOk();
  });
  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('uses the configured business name in the system prompt instead of a hardcoded one', async () => {
    const prisma = makePrisma();
    prisma.shopSettings.findUnique.mockResolvedValue({ businessName: 'Iron Fuel' });
    const service = new AiService(prisma);

    await service.chat('cust-1', [{ role: 'user', content: 'What is on the menu?' }]);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.system).toContain('Iron Fuel');
    expect(body.system).not.toContain('Protein Panda');
  });

  it('falls back to "Protein Panda" if shop settings have never been configured', async () => {
    const prisma = makePrisma();
    prisma.shopSettings.findUnique.mockResolvedValue(null);
    const service = new AiService(prisma);

    await service.chat('cust-1', [{ role: 'user', content: 'What is on the menu?' }]);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.system).toContain('Protein Panda');
  });
});
