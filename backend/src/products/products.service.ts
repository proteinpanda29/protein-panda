import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  // Paginated — never load the full catalog in one go.
  async list(params: { categorySlug?: string; take?: number; cursor?: string }) {
    const { categorySlug, take = 20, cursor } = params;

    return this.prisma.product.findMany({
      where: {
        isActive: true,
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { name: 'asc' },
      include: { nutrition: true, category: true, addonOptions: true, allergens: { include: { allergen: true } } },
    });
  }

  async getBySlug(slug: string) {
    // Found via a real HTTP integration test (not a unit test — those
    // never touch what the controller actually returns to a client):
    // this used to return `200 OK` with a `null` body for a slug that
    // doesn't exist, since findUnique silently returns null rather than
    // erroring. A missing product should read as "this doesn't exist,"
    // not as "successfully fetched nothing."
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: { nutrition: true, allergens: { include: { allergen: true } }, addonOptions: true },
    });
    if (!product) throw new NotFoundException(`No product found with slug "${slug}"`);
    return product;
  }

  async listReviews(productId: string) {
    return this.prisma.review.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true } } },
    });
  }

  /** Only customers who actually ordered this product can review it. */
  async addReview(customerId: string, productId: string, rating: number, comment?: string, photoUrls?: string[]) {
    if (rating < 1 || rating > 5) throw new BadRequestException('Rating must be between 1 and 5');

    // Capped, not unlimited — a review is a quick "here's what I got"
    // note, not a photo album. 5 is generous for that purpose while
    // still ruling out someone using this as free unlimited storage.
    const cappedPhotoUrls = (photoUrls ?? []).slice(0, 5);

    const purchased = await this.prisma.orderItem.findFirst({
      where: { productId, order: { customerId, status: { notIn: ['RECEIVED', 'CANCELLED'] } } },
    });
    if (!purchased) {
      throw new BadRequestException('You can only review products from a delivered order');
    }

    return this.prisma.review.create({ data: { customerId, productId, rating, comment, photoUrls: cappedPhotoUrls } });
  }
}
