import { BadRequestException, Injectable } from '@nestjs/common';
import { StaffDepartment } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class StaffService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async listStaff() {
    return this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'DELIVERY'] } },
      orderBy: { createdAt: 'desc' },
      include: { staff: true, deliveryPerson: true },
    });
  }

  /**
   * Provisioning a staff/rider account is admin-initiated and doesn't go
   * through OTP verification — the admin is vouching for this person
   * directly (same trust model as the POS walk-in customer flow), not a
   * self-service signup. Only CUSTOMER accounts self-signup via OTP.
   */
  async createStaff(data: {
    role: 'ADMIN' | 'DELIVERY';
    name: string;
    identifier: string;
    position?: string;
    vehicleInfo?: string;
    // Only meaningful for role=ADMIN. Omitted/empty means Owner — full
    // access to every department (see Staff.departments docstring in
    // schema.prisma). A staff member can now hold more than one
    // department at once. Ignored entirely for DELIVERY accounts, which
    // have no department concept at all.
    departments?: StaffDepartment[];
    // Defaults to MANAGER (full access within their department) when
    // omitted — matches the Staff schema field's own default, so
    // creating a staff member without specifying this behaves exactly
    // as it always has.
    permissionLevel?: 'VIEWER' | 'MANAGER';
  }) {
    if (!data.name?.trim()) throw new BadRequestException('Name is required');
    if (!data.identifier?.trim()) throw new BadRequestException('A phone number or email is required');
    if (data.role !== 'ADMIN' && data.role !== 'DELIVERY') {
      throw new BadRequestException('Role must be ADMIN or DELIVERY');
    }

    const isEmailIdentifier = EMAIL_RE.test(data.identifier);
    const existing = isEmailIdentifier
      ? await this.prisma.user.findUnique({ where: { email: data.identifier } })
      : await this.prisma.user.findUnique({ where: { phone: data.identifier } });
    if (existing) throw new BadRequestException('An account with this phone/email already exists');

    return this.prisma.user.create({
      data: {
        role: data.role,
        phone: isEmailIdentifier ? null : data.identifier,
        email: isEmailIdentifier ? data.identifier : null,
        ...(data.role === 'ADMIN'
          ? { staff: { create: { name: data.name.trim(), position: data.position?.trim() || null, departments: data.departments ?? [], ...(data.permissionLevel ? { permissionLevel: data.permissionLevel } : {}) } } }
          : { deliveryPerson: { create: { name: data.name.trim(), vehicleInfo: data.vehicleInfo?.trim() || null } } }),
      },
      include: { staff: true, deliveryPerson: true },
    });
  }

  async updateStaff(userId: string, data: { name?: string; position?: string; vehicleInfo?: string; departments?: StaffDepartment[]; permissionLevel?: 'VIEWER' | 'MANAGER' }, actorUserId?: string, actorRole?: 'ADMIN' | 'CUSTOMER' | 'DELIVERY') {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { staff: true, deliveryPerson: true },
    });

    if (user.role === 'ADMIN' && user.staff) {
      const beforeDepartments = user.staff.departments;
      const updated = await this.prisma.staff.update({
        where: { id: user.staff.id },
        data: { name: data.name, position: data.position, ...(data.departments !== undefined ? { departments: data.departments } : {}), ...(data.permissionLevel !== undefined ? { permissionLevel: data.permissionLevel } : {}) },
      });

      if (actorUserId && data.departments !== undefined) {
        const changed = JSON.stringify([...beforeDepartments].sort()) !== JSON.stringify([...data.departments].sort());
        if (changed) {
          this.auditLog
            .record({
              actorUserId,
              actorRole: actorRole ?? 'ADMIN',
              action: 'STAFF_DEPARTMENTS_CHANGED',
              entityType: 'Staff',
              entityId: user.staff.id,
              summary: `${user.staff.name}: departments changed from [${beforeDepartments.join(', ') || 'Owner'}] to [${data.departments.join(', ') || 'Owner'}]`,
              metadata: { from: beforeDepartments, to: data.departments },
            })
            .catch(() => undefined);
        }
      }

      return updated;
    }
    if (user.role === 'DELIVERY' && user.deliveryPerson) {
      return this.prisma.deliveryPerson.update({
        where: { id: user.deliveryPerson.id },
        data: { name: data.name, vehicleInfo: data.vehicleInfo },
      });
    }
    throw new BadRequestException('This account has no matching staff/delivery profile to update');
  }

  /** Soft-disable — instantly revokes access (enforced in JwtStrategy on every request), never deletes history. */
  async setActive(userId: string, isActive: boolean, actorUserId?: string) {
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { isActive } });

    if (actorUserId) {
      const target = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { staff: { select: { name: true } }, deliveryPerson: { select: { name: true } } },
      });
      const targetName = target?.staff?.name ?? target?.deliveryPerson?.name ?? 'Unknown';
      this.auditLog
        .record({
          actorUserId,
          actorRole: 'ADMIN',
          action: isActive ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED',
          entityType: 'Staff',
          entityId: userId,
          summary: `${targetName} was ${isActive ? 'activated' : 'deactivated'}`,
        })
        .catch(() => undefined);
    }

    return updated;
  }
}
