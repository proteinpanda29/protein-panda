import { FavouritesService } from './favourites.service';

function makeHarness() {
  const prisma = {
    favourite: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
  const service = new FavouritesService(prisma);
  return { service, prisma };
}

describe('FavouritesService.list', () => {
  it('returns the flattened products, not the raw join-table rows', async () => {
    const { service, prisma } = makeHarness();
    prisma.favourite.findMany.mockResolvedValue([
      { customerId: 'cust-1', productId: 'p1', product: { id: 'p1', name: 'Choc Shake' } },
      { customerId: 'cust-1', productId: 'p2', product: { id: 'p2', name: 'Protein Oats' } },
    ]);

    const result = await service.list('cust-1');

    expect(result).toEqual([{ id: 'p1', name: 'Choc Shake' }, { id: 'p2', name: 'Protein Oats' }]);
  });

  it('orders by most recently favourited first', async () => {
    const { service, prisma } = makeHarness();

    await service.list('cust-1');

    expect(prisma.favourite.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));
  });
});

describe('FavouritesService.add', () => {
  it('upserts rather than creates — favouriting an already-favourited product is a no-op, not an error', async () => {
    const { service, prisma } = makeHarness();

    const result = await service.add('cust-1', 'p1');

    expect(prisma.favourite.upsert).toHaveBeenCalledWith({
      where: { customerId_productId: { customerId: 'cust-1', productId: 'p1' } },
      create: { customerId: 'cust-1', productId: 'p1' },
      update: {},
    });
    expect(result).toEqual({ favourited: true });
  });
});

describe('FavouritesService.remove', () => {
  it('uses deleteMany, not delete — removing something never favourited is a harmless no-op, not a 404', async () => {
    const { service, prisma } = makeHarness();

    const result = await service.remove('cust-1', 'p1');

    expect(prisma.favourite.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'cust-1', productId: 'p1' } });
    expect(result).toEqual({ favourited: false });
  });
});

describe('FavouritesService.listFavouritedProductIds', () => {
  it('returns just the ids, for cheaply marking hearts on a product list', async () => {
    const { service, prisma } = makeHarness();
    prisma.favourite.findMany.mockResolvedValue([{ productId: 'p1' }, { productId: 'p2' }]);

    const result = await service.listFavouritedProductIds('cust-1');

    expect(result).toEqual(['p1', 'p2']);
  });
});
