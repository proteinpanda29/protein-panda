import { BadRequestException } from '@nestjs/common';
import { StaffService } from './staff.service';

function makeHarness() {
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    staff: { update: jest.fn() },
    deliveryPerson: { update: jest.fn() },
  } as any;
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new StaffService(prisma, auditLog);
  return { service, prisma, auditLog };
}

describe('StaffService.createStaff', () => {
  it('rejects a missing name', async () => {
    const { service } = makeHarness();
    await expect(service.createStaff({ role: 'ADMIN', name: '', identifier: '+919876543210' })).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing identifier', async () => {
    const { service } = makeHarness();
    await expect(service.createStaff({ role: 'ADMIN', name: 'Ravi', identifier: '' })).rejects.toThrow(BadRequestException);
  });

  it('rejects a role other than ADMIN or DELIVERY', async () => {
    const { service } = makeHarness();
    await expect(
      service.createStaff({ role: 'CUSTOMER' as any, name: 'Ravi', identifier: '+919876543210' }),
    ).rejects.toThrow(/must be ADMIN or DELIVERY/);
  });

  it('refuses to create a duplicate account for an identifier already in use', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(service.createStaff({ role: 'ADMIN', name: 'Ravi', identifier: '+919876543210' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('creates an ADMIN account with a nested Staff profile (position optional)', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1' });

    await service.createStaff({ role: 'ADMIN', name: 'Ravi', identifier: '+919876543210', position: 'Manager' });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'ADMIN',
          phone: '+919876543210',
          email: null,
          staff: { create: { name: 'Ravi', position: 'Manager', departments: [] } },
        }),
      }),
    );
  });

  it('creates an ADMIN account holding MULTIPLE departments at once', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1' });

    await service.createStaff({
      role: 'ADMIN',
      name: 'Priya',
      identifier: '+919876543211',
      departments: ['OPERATIONS', 'SUPPLY_CHAIN'],
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          staff: { create: { name: 'Priya', position: null, departments: ['OPERATIONS', 'SUPPLY_CHAIN'] } },
        }),
      }),
    );
  });

  it('creates a DELIVERY account with a nested DeliveryPerson profile', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1' });

    await service.createStaff({ role: 'DELIVERY', name: 'Arun', identifier: 'arun@example.com', vehicleInfo: 'Bike KA01' });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'DELIVERY',
          phone: null,
          email: 'arun@example.com',
          deliveryPerson: { create: { name: 'Arun', vehicleInfo: 'Bike KA01' } },
        }),
      }),
    );
  });

  it('defaults to no explicit permissionLevel when not specified — the Staff schema field\'s own default (MANAGER) applies', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1' });

    await service.createStaff({ role: 'ADMIN', name: 'Priya', identifier: '+919876543210' });

    const call = prisma.user.create.mock.calls[0][0];
    expect(call.data.staff.create.permissionLevel).toBeUndefined();
  });

  it('sets permissionLevel to VIEWER when explicitly requested', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1' });

    await service.createStaff({ role: 'ADMIN', name: 'Priya', identifier: '+919876543210', permissionLevel: 'VIEWER' });

    const call = prisma.user.create.mock.calls[0][0];
    expect(call.data.staff.create.permissionLevel).toBe('VIEWER');
  });
});

describe('StaffService.updateStaff', () => {
  it('updates the Staff profile for an ADMIN-role user', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ role: 'ADMIN', staff: { id: 'staff-1' }, deliveryPerson: null });

    await service.updateStaff('user-1', { name: 'New Name', position: 'Owner' });

    expect(prisma.staff.update).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { name: 'New Name', position: 'Owner' },
    });
  });

  it('updates the DeliveryPerson profile for a DELIVERY-role user', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ role: 'DELIVERY', staff: null, deliveryPerson: { id: 'dp-1' } });

    await service.updateStaff('user-1', { vehicleInfo: 'New Bike' });

    expect(prisma.deliveryPerson.update).toHaveBeenCalledWith({
      where: { id: 'dp-1' },
      data: { name: undefined, vehicleInfo: 'New Bike' },
    });
  });

  it('records a real audit log entry when departments actually change, naming the real staff member and both old/new lists', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      role: 'ADMIN',
      staff: { id: 'staff-1', name: 'Priya', departments: ['SALES'] },
      deliveryPerson: null,
    });

    await service.updateStaff('user-1', { departments: ['SALES', 'LOYALTY'] as any }, 'admin-user-1', 'ADMIN');

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-user-1',
        action: 'STAFF_DEPARTMENTS_CHANGED',
        entityType: 'Staff',
        entityId: 'staff-1',
        summary: expect.stringContaining('Priya'),
        metadata: { from: ['SALES'], to: ['SALES', 'LOYALTY'] },
      }),
    );
  });

  it('does not log anything when the departments list is unchanged (even if reordered)', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      role: 'ADMIN',
      staff: { id: 'staff-1', name: 'Priya', departments: ['SALES', 'LOYALTY'] },
      deliveryPerson: null,
    });

    await service.updateStaff('user-1', { departments: ['LOYALTY', 'SALES'] as any }, 'admin-user-1', 'ADMIN');

    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('does not log anything at all when no actor is given', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      role: 'ADMIN',
      staff: { id: 'staff-1', name: 'Priya', departments: ['SALES'] },
      deliveryPerson: null,
    });

    await service.updateStaff('user-1', { departments: ['LOYALTY'] as any });

    expect(auditLog.record).not.toHaveBeenCalled();
  });
});

describe('StaffService.setActive', () => {
  it('toggles the User.isActive flag', async () => {
    const { service, prisma } = makeHarness();
    prisma.user.update.mockResolvedValue({});

    await service.setActive('user-1', false);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { isActive: false } });
  });

  it('records a real audit log entry with the real staff member\'s name when an actor is given', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.user.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ staff: { name: 'Priya' }, deliveryPerson: null });

    await service.setActive('user-1', false, 'admin-1');

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'admin-1', action: 'STAFF_DEACTIVATED', entityType: 'Staff', entityId: 'user-1', summary: expect.stringContaining('Priya') }),
    );
  });

  it('falls back to the delivery person\'s name when the target has no staff profile', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.user.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ staff: null, deliveryPerson: { name: 'Lathif' } });

    await service.setActive('user-1', true, 'admin-1');

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'STAFF_ACTIVATED', summary: expect.stringContaining('Lathif') }));
  });

  it('does not attempt to look up a name or log anything when no actor is given', async () => {
    const { service, prisma, auditLog } = makeHarness();
    prisma.user.update.mockResolvedValue({});

    await service.setActive('user-1', false);

    expect(auditLog.record).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
