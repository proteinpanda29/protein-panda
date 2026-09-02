import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class FavouritesService {
  constructor(private prisma: PrismaService) {}

  async list(customerId: string) {
    const rows = await this.prisma.favourite.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { product: { include: { nutrition: true, category: true } } },
    });
    // Flattened to just the products themselves — the frontend wants a
    // product list to render with the existing menu card component, not
    // a list of join-table rows wrapping each one.
    return rows.map((r: { product: unknown }) => r.product);
  }

  async add(customerId: string, productId: string) {
    // Upsert, not create — favouriting something already favourited is
    // a no-op, not an error. A customer tapping a heart icon twice by
    // accident (a slow network making the first tap's result unclear)
    // should never see an error for something that's already true.
    await this.prisma.favourite.upsert({
      where: { customerId_productId: { customerId, productId } },
      create: { customerId, productId },
      update: {},
    });
    return { favourited: true };
  }

  async remove(customerId: string, productId: string) {
    // deleteMany, not delete — removing something that was never
    // favourited (or was already removed by a near-simultaneous second
    // tap) should be a harmless no-op, not a 404 the frontend has to
    // specifically handle.
    await this.prisma.favourite.deleteMany({ where: { customerId, productId } });
    return { favourited: false };
  }

  async listFavouritedProductIds(customerId: string): Promise<string[]> {
    const rows = await this.prisma.favourite.findMany({ where: { customerId }, select: { productId: true } });
    return rows.map((r: { productId: string }) => r.productId);
  }
}
