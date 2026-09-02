import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface AuditLogInput {
  actorUserId: string;
  actorRole: 'ADMIN' | 'CUSTOMER' | 'DELIVERY';
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  private logger = new Logger('AuditLogService');

  constructor(private prisma: PrismaService) {}

  /**
   * Never throws — a failure to WRITE the audit trail must never block
   * or fail the real action being audited (e.g. a price change should
   * still go through even if, for some reason, logging it fails).
   */
  async record(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: input });
    } catch (err) {
      this.logger.error(`Failed to write audit log for ${input.action}: ${(err as Error).message}`);
    }
  }

  async list(params: { entityType?: string; entityId?: string; actorUserId?: string; take?: number; cursor?: string }) {
    const { entityType, entityId, actorUserId, take = 50, cursor } = params;
    return this.prisma.auditLog.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(actorUserId ? { actorUserId } : {}),
      },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { phone: true, email: true, staff: { select: { name: true } } } } },
    });
  }
}
