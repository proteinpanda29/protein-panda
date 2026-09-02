import { ProductsService } from './products.service';

function makeHarness() {
  const prisma = {
    product: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    orderItem: { findFirst: jest.fn() },
    review: { findMany: jest.fn(), create: jest.fn() },
  } as any;
  const service = new ProductsService(prisma);
  return { service, prisma };
}

describe('ProductsService.list', () => {
  it('includes allergens in the public menu listing so customers can see warnings before ordering', async () => {
    const { service, prisma } = makeHarness();

    await service.list({});

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ allergens: { include: { allergen: true } } }),
      }),
    );
  });

  it('only ever returns active products', async () => {
    const { service, prisma } = makeHarness();

    await service.list({});

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    );
  });
});

describe('ProductsService.getBySlug', () => {
  it('throws NotFoundException for a slug that does not match any product — found via a real HTTP integration test, not a unit test, since this used to silently return 200/null instead', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.getBySlug('does-not-exist')).rejects.toThrow(/No product found/);
  });

  it('returns the product when the slug matches', async () => {
    const { service, prisma } = makeHarness();
    prisma.product.findUnique.mockResolvedValue({ id: 'p1', slug: 'chocolate-shake', name: 'Chocolate Shake' });

    const result = await service.getBySlug('chocolate-shake');

    expect(result.name).toBe('Chocolate Shake');
  });
});

describe('ProductsService.addReview', () => {
  it('rejects a rating outside 1-5', async () => {
    const { service } = makeHarness();

    await expect(service.addReview('cust-1', 'prod-1', 0)).rejects.toThrow(/between 1 and 5/);
    await expect(service.addReview('cust-1', 'prod-1', 6)).rejects.toThrow(/between 1 and 5/);
  });

  it('refuses a review from a customer who never actually ordered the product', async () => {
    const { service, prisma } = makeHarness();
    prisma.orderItem.findFirst.mockResolvedValue(null);

    await expect(service.addReview('cust-1', 'prod-1', 5)).rejects.toThrow(/delivered order/);
  });

  it('saves the review with its photo URLs when the customer genuinely ordered the product', async () => {
    const { service, prisma } = makeHarness();
    prisma.orderItem.findFirst.mockResolvedValue({ id: 'item-1' });

    await service.addReview('cust-1', 'prod-1', 5, 'Great shake!', ['https://cloudinary.com/a.jpg', 'https://cloudinary.com/b.jpg']);

    expect(prisma.review.create).toHaveBeenCalledWith({
      data: { customerId: 'cust-1', productId: 'prod-1', rating: 5, comment: 'Great shake!', photoUrls: ['https://cloudinary.com/a.jpg', 'https://cloudinary.com/b.jpg'] },
    });
  });

  it('caps photos at 5 — a review is a quick note, not unlimited photo storage', async () => {
    const { service, prisma } = makeHarness();
    prisma.orderItem.findFirst.mockResolvedValue({ id: 'item-1' });
    const eightPhotos = Array.from({ length: 8 }, (_, i) => `https://cloudinary.com/${i}.jpg`);

    await service.addReview('cust-1', 'prod-1', 5, undefined, eightPhotos);

    const call = prisma.review.create.mock.calls[0][0];
    expect(call.data.photoUrls).toHaveLength(5);
  });

  it('defaults to an empty array, not undefined, when no photos are attached at all', async () => {
    const { service, prisma } = makeHarness();
    prisma.orderItem.findFirst.mockResolvedValue({ id: 'item-1' });

    await service.addReview('cust-1', 'prod-1', 4);

    const call = prisma.review.create.mock.calls[0][0];
    expect(call.data.photoUrls).toEqual([]);
  });
});
