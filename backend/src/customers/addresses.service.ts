import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface AddressInput {
  label: 'HOME' | 'WORK' | 'OTHER';
  nickname?: string;
  addressLine: string;
  phone: string;
  instructions?: string;
  isDefault?: boolean;
  pincode?: string;
}

@Injectable()
export class AddressesService {
  constructor(private prisma: PrismaService) {}

  async list(customerId: string) {
    return this.prisma.address.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(customerId: string, input: AddressInput) {
    if (!input.addressLine?.trim()) throw new BadRequestException('Address line is required');
    if (!input.phone?.trim()) throw new BadRequestException('Phone is required');

    // The very first address a customer ever saves becomes their
    // default automatically — there's no meaningful "not default" state
    // when there's nothing to compare against, and it avoids a customer
    // having to remember to explicitly mark their one and only address.
    const existingCount = await this.prisma.address.count({ where: { customerId } });
    const isDefault = input.isDefault ?? existingCount === 0;

    if (isDefault) {
      await this.prisma.address.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
    }

    return this.prisma.address.create({
      data: {
        customerId,
        label: input.label,
        nickname: input.nickname,
        addressLine: input.addressLine.trim(),
        phone: input.phone.trim(),
        instructions: input.instructions?.trim(),
        pincode: input.pincode?.trim(),
        isDefault,
      },
    });
  }

  async update(customerId: string, addressId: string, input: Partial<AddressInput>) {
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address) throw new NotFoundException('Address not found');
    if (address.customerId !== customerId) throw new ForbiddenException('This address does not belong to you');

    if (input.isDefault) {
      await this.prisma.address.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
    }

    return this.prisma.address.update({
      where: { id: addressId },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
        ...(input.addressLine !== undefined ? { addressLine: input.addressLine.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions?.trim() } : {}),
        ...(input.pincode !== undefined ? { pincode: input.pincode?.trim() } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
    });
  }

  async remove(customerId: string, addressId: string) {
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address) throw new NotFoundException('Address not found');
    if (address.customerId !== customerId) throw new ForbiddenException('This address does not belong to you');

    await this.prisma.address.delete({ where: { id: addressId } });

    // If the deleted address was the default and other addresses still
    // exist, promote the most recently added one — a customer should
    // never be left with saved addresses but no default at all.
    if (address.isDefault) {
      const next = await this.prisma.address.findFirst({ where: { customerId }, orderBy: { createdAt: 'desc' } });
      if (next) await this.prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }

    return { deleted: true };
  }
}
