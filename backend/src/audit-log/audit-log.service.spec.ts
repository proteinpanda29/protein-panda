import { AuditLogService } from './audit-log.service';

function makeHarness() {
  const prisma = {
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
  const service = new AuditLogService(prisma);
  return { service, prisma };
}

describe('AuditLogService.record', () => {
  it('writes a real audit log entry with all the given fields', async () => {
    const { service, prisma } = makeHarness();

    await service.record({
      actorUserId: 'user-1',
      actorRole: 'ADMIN',
      action: 'PRODUCT_PRICE_CHANGED',
      entityType: 'Product',
      entityId: 'prod-1',
      summary: 'Changed price from ₹180 to ₹220',
      metadata: { from: 180, to: 220 },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        actorRole: 'ADMIN',
        action: 'PRODUCT_PRICE_CHANGED',
        entityType: 'Product',
        entityId: 'prod-1',
        summary: 'Changed price from ₹180 to ₹220',
        metadata: { from: 180, to: 220 },
      },
    });
  });

  it('never throws even if the write itself fails — logging a change must never block the real action', async () => {
    const { service, prisma } = makeHarness();
    prisma.auditLog.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.record({ actorUserId: 'user-1', actorRole: 'ADMIN', action: 'X', entityType: 'Y', summary: 'Z' }),
    ).resolves.toBeUndefined();
  });
});

describe('AuditLogService.list', () => {
  it('returns the most recent entries first', async () => {
    const { service, prisma } = makeHarness();

    await service.list({});

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));
  });

  it('filters by entity type and id when given, to see the full history of one specific record', async () => {
    const { service, prisma } = makeHarness();

    await service.list({ entityType: 'Product', entityId: 'prod-1' });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entityType: 'Product', entityId: 'prod-1' } }),
    );
  });

  it('filters by actor when given, to see everything one specific staff member has done', async () => {
    const { service, prisma } = makeHarness();

    await service.list({ actorUserId: 'user-1' });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { actorUserId: 'user-1' } }));
  });

  it('applies no filters at all when none are given — a full, unfiltered recent history', async () => {
    const { service, prisma } = makeHarness();

    await service.list({});

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
