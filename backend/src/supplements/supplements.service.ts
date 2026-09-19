import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class SupplementsService {
  constructor(private prisma: PrismaService) {}

  // Public — the whole point is customer-facing transparency.
  async listPublic() {
    return this.prisma.supplementBrand.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { supplements: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
  }

  async listAllForAdmin() {
    return this.prisma.supplementBrand.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { supplements: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async createBrand(data: { name: string; description?: string; logoUrl?: string; websiteUrl?: string }) {
    if (!data.name?.trim()) throw new BadRequestException('Brand name is required');
    return this.prisma.supplementBrand.create({ data });
  }

  async updateBrand(id: string, data: Partial<{ name: string; description: string; logoUrl: string; websiteUrl: string; isActive: boolean; sortOrder: number }>) {
    return this.prisma.supplementBrand.update({ where: { id }, data });
  }

  async deleteBrand(id: string) {
    return this.prisma.supplementBrand.delete({ where: { id } });
  }

  async createSupplement(data: { brandId: string; name: string; description?: string; imageUrl?: string; labCertificateUrl?: string; labTestedDate?: string }) {
    if (!data.name?.trim()) throw new BadRequestException('Supplement name is required');
    return this.prisma.supplementProduct.create({
      data: { ...data, labTestedDate: data.labTestedDate ? new Date(data.labTestedDate) : undefined },
    });
  }

  async updateSupplement(
    id: string,
    data: Partial<{ name: string; description: string; imageUrl: string; labCertificateUrl: string; labTestedDate: string; isActive: boolean; sortOrder: number }>,
  ) {
    const { labTestedDate, ...rest } = data;
    return this.prisma.supplementProduct.update({
      where: { id },
      data: { ...rest, ...(labTestedDate !== undefined ? { labTestedDate: labTestedDate ? new Date(labTestedDate) : null } : {}) },
    });
  }

  async deleteSupplement(id: string) {
    return this.prisma.supplementProduct.delete({ where: { id } });
  }
}
