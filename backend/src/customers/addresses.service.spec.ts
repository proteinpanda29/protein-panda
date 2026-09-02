import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AddressesService } from './addresses.service';

function makeHarness() {
  const prisma = {
    address: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'addr-1', ...data })),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({}),
    },
  } as any;
  const service = new AddressesService(prisma);
  return { service, prisma };
}

describe('AddressesService.create', () => {
  it('rejects an address with no address line', async () => {
    const { service } = makeHarness();

    await expect(service.create('cust-1', { label: 'HOME', addressLine: '', phone: '9876543210' })).rejects.toThrow(BadRequestException);
  });

  it('rejects an address with no phone', async () => {
    const { service } = makeHarness();

    await expect(service.create('cust-1', { label: 'HOME', addressLine: '221B Baker St', phone: '' })).rejects.toThrow(BadRequestException);
  });

  it('actually persists the pincode when creating an address — previously silently dropped since the service layer never mapped it through to the database', async () => {
    const { service, prisma } = makeHarness();

    await service.create('cust-1', { label: 'HOME', addressLine: '221B Baker St', phone: '9876543210', pincode: '560001' });

    expect(prisma.address.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pincode: '560001' }) }),
    );
  });

  it('makes the very first saved address the default automatically', async () => {
    const { service, prisma } = makeHarness();
    prisma.address.count.mockResolvedValue(0);

    const result = await service.create('cust-1', { label: 'HOME', addressLine: '221B Baker St', phone: '9876543210' });

    expect(result.isDefault).toBe(true);
  });

  it('does not make a second address the default automatically unless explicitly asked', async () => {
    const { service, prisma } = makeHarness();
    prisma.address.count.mockResolvedValue(1);

    const result = await service.create('cust-1', { label: 'WORK', addressLine: 'Office Park', phone: '9876543210' });

    expect(result.isDefault).toBe(false);
  });

  it('unsets the previous default before setting a new one, so there is never more than one default at a time', async () => {
    const { service, prisma } = makeHarness();
    prisma.address.count.mockResolvedValue(1);

    await service.create('cust-1', { label: 'WORK', addressLine: 'Office Park', phone: '9876543210', isDefault: true });

    expect(prisma.address.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', isDefault: true },
      data: { isDefault: false },
    });
  });
});

describe('AddressesService.update', () => {
  it('throws NotFoundException for an address that does not exist', async () => {
    const { service, prisma } = makeHarness();
    prisma.address.findUnique.mockResolvedValue(null);

    await expect(service.update('cust-1', 'addr-x', { addressLine: 'New' })).rejects.toThrow(NotFoundException);
  });

  it('refuses to update an address belonging to a different customer', async () => {
    const { service, prisma } = makeHarness();
    prisma.address.findUnique.mockResolvedValue({ id: 'addr-1', customerId: 'someone-else' });

    await expect(service.update('cust-1', 'addr-1', { addressLine: 'New' })).rejects.toThrow(ForbiddenException);
  });

  it('unsets any other default when this one is marked default', async () => {
    const { service, prisma } = makeHarness();
    prisma.address.findUnique.mockResolvedValue({ id: 'addr-1', customerId: 'cust-1' });

    await service.update('cust-1', 'addr-1', { isDefault: true });

    expect(prisma.address.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', isDefault: true },
      data: { isDefault: false },
    });
  });
});

describe('AddressesService.remove', () => {
  it('refuses to delete an address belonging to a different customer', async () => {
    const { service, prisma } = makeHarness();
    prisma.address.findUnique.mockResolvedValue({ id: 'addr-1', customerId: 'someone-else' });

    await expect(service.remove('cust-1', 'addr-1')).rejects.toThrow(ForbiddenException);
  });

  it('promotes the most recent remaining address to default when the deleted one was the default', async () => {
    const { service, prisma } = makeHarness();
    prisma.address.findUnique.mockResolvedValue({ id: 'addr-1', customerId: 'cust-1', isDefault: true });
    prisma.address.findFirst.mockResolvedValue({ id: 'addr-2' });

    await service.remove('cust-1', 'addr-1');

    expect(prisma.address.update).toHaveBeenCalledWith({ where: { id: 'addr-2' }, data: { isDefault: true } });
  });

  it('does not try to promote anything when no addresses remain', async () => {
    const { service, prisma } = makeHarness();
    prisma.address.findUnique.mockResolvedValue({ id: 'addr-1', customerId: 'cust-1', isDefault: true });
    prisma.address.findFirst.mockResolvedValue(null);

    await expect(service.remove('cust-1', 'addr-1')).resolves.toEqual({ deleted: true });
    expect(prisma.address.update).not.toHaveBeenCalled();
  });

  it('does not touch the default when deleting a non-default address', async () => {
    const { service, prisma } = makeHarness();
    prisma.address.findUnique.mockResolvedValue({ id: 'addr-1', customerId: 'cust-1', isDefault: false });

    await service.remove('cust-1', 'addr-1');

    expect(prisma.address.update).not.toHaveBeenCalled();
  });
});
