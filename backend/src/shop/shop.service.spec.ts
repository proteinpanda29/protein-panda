import { ShopService } from './shop.service';

function makeHarness() {
  const prisma: any = {
    shopSettings: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    deliveryZone: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  };
  const service = new ShopService(prisma);
  return { service, prisma };
}

describe('ShopService.getStatus', () => {
  it('creates the default settings row on first access (upsert), never throwing if none exists yet', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.upsert.mockResolvedValue({ id: 'default', businessName: 'Protein Panda' });

    const result = await service.getStatus();

    expect(prisma.shopSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    expect(result.businessName).toBe('Protein Panda');
  });
});

describe('ShopService.isOpen', () => {
  it('defaults to open when settings have never been configured', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue(null);

    await expect(service.isOpen()).resolves.toBe(true);
  });

  it('reflects the configured isOpen value', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue({ isOpen: false });

    await expect(service.isOpen()).resolves.toBe(false);
  });
});

describe('ShopService.isPincodeServiceable', () => {
  it('accepts every pincode when the shop has never configured any — checking is effectively off by default', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue({ deliverablePincodes: [] });

    await expect(service.isPincodeServiceable('560001')).resolves.toBe(true);
  });

  it('accepts every pincode when settings have never been created at all', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue(null);

    await expect(service.isPincodeServiceable('560001')).resolves.toBe(true);
  });

  it('accepts a pincode that is in the configured list', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue({ deliverablePincodes: ['560001', '560002'] });

    await expect(service.isPincodeServiceable('560002')).resolves.toBe(true);
  });

  it('rejects a pincode that is not in the configured list, once the list is non-empty', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue({ deliverablePincodes: ['560001', '560002'] });

    await expect(service.isPincodeServiceable('560099')).resolves.toBe(false);
  });

  it('normalizes whitespace so a stray space does not cause a false rejection', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue({ deliverablePincodes: [' 560001 '] });

    await expect(service.isPincodeServiceable('560001')).resolves.toBe(true);
  });
});

describe('ShopService.updateStatus — white-label branding fields', () => {
  it('passes businessName, tagline, logoUrl, and color fields straight through to the upsert', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.upsert.mockResolvedValue({});

    await service.updateStatus({
      businessName: 'Iron Fuel',
      tagline: 'Strength in every sip',
      logoUrl: 'https://example.com/logo.png',
      primaryColorHex: '#112233',
      accentColorHex: '#445566',
      backgroundColorHex: '#F0F0F0',
    });

    expect(prisma.shopSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      update: {
        businessName: 'Iron Fuel',
        tagline: 'Strength in every sip',
        logoUrl: 'https://example.com/logo.png',
        primaryColorHex: '#112233',
        accentColorHex: '#445566',
        backgroundColorHex: '#F0F0F0',
      },
      create: {
        id: 'default',
        businessName: 'Iron Fuel',
        tagline: 'Strength in every sip',
        logoUrl: 'https://example.com/logo.png',
        primaryColorHex: '#112233',
        accentColorHex: '#445566',
        backgroundColorHex: '#F0F0F0',
      },
    });
  });
});

describe('ShopService.createDeliveryZone', () => {
  it('rejects a non-positive max distance', async () => {
    const { service } = makeHarness();
    await expect(service.createDeliveryZone({ name: 'Nearby', maxDistanceKm: 0, feeRs: 20 })).rejects.toThrow(/distance must be positive/);
  });

  it('rejects a negative fee', async () => {
    const { service } = makeHarness();
    await expect(service.createDeliveryZone({ name: 'Nearby', maxDistanceKm: 3, feeRs: -10 })).rejects.toThrow(/cannot be negative/);
  });

  it('creates a real zone with the given values', async () => {
    const { service, prisma } = makeHarness();
    await service.createDeliveryZone({ name: 'Nearby', maxDistanceKm: 3, feeRs: 20, estimatedMinutes: 20 });
    expect(prisma.deliveryZone.create).toHaveBeenCalledWith({ data: { name: 'Nearby', maxDistanceKm: 3, feeRs: 20, estimatedMinutes: 20 } });
  });
});

describe('ShopService.quoteDeliveryFee', () => {
  it('returns null when the shop has not configured its own location at all', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue({ shopLat: null, shopLng: null });

    const result = await service.quoteDeliveryFee(12.9, 77.6);

    expect(result).toBeNull();
  });

  it('returns null when no active delivery zones are configured at all', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue({ shopLat: 12.9716, shopLng: 77.5946 });
    prisma.deliveryZone.findMany.mockResolvedValue([]);

    const result = await service.quoteDeliveryFee(12.9716, 77.5946);

    expect(result).toBeNull();
  });

  it('returns null (not deliverable) when the customer is beyond every configured zone', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue({ shopLat: 12.9716, shopLng: 77.5946 });
    prisma.deliveryZone.findMany.mockResolvedValue([{ id: 'z1', name: 'Nearby', maxDistanceKm: 3, feeRs: 20, estimatedMinutes: 20 }]);

    // ~100km away — far outside a 3km zone
    const result = await service.quoteDeliveryFee(13.9, 78.5);

    expect(result).toBeNull();
  });

  it('picks the correct (nearest/cheapest) zone for a customer within range', async () => {
    const { service, prisma } = makeHarness();
    prisma.shopSettings.findUnique.mockResolvedValue({ shopLat: 12.9716, shopLng: 77.5946 });
    prisma.deliveryZone.findMany.mockResolvedValue([
      { id: 'z1', name: 'Nearby', maxDistanceKm: 3, feeRs: 20, estimatedMinutes: 20 },
      { id: 'z2', name: 'Standard', maxDistanceKm: 7, feeRs: 40, estimatedMinutes: 35 },
    ]);

    // Same coordinates as the shop itself — 0km away, well within zone 1
    const result = await service.quoteDeliveryFee(12.9716, 77.5946);

    expect(result).toEqual(expect.objectContaining({ zoneId: 'z1', zoneName: 'Nearby', feeRs: 20 }));
  });

  it('correctly falls into the SECOND zone when beyond the first zone\'s range but within the second\'s', async () => {
    const { service, prisma } = makeHarness();
    // Shop at one point, customer roughly 5km north — beyond a 3km
    // zone but within a 7km zone. 0.045 degrees latitude is
    // approximately 5km.
    prisma.shopSettings.findUnique.mockResolvedValue({ shopLat: 12.9716, shopLng: 77.5946 });
    prisma.deliveryZone.findMany.mockResolvedValue([
      { id: 'z1', name: 'Nearby', maxDistanceKm: 3, feeRs: 20, estimatedMinutes: 20 },
      { id: 'z2', name: 'Standard', maxDistanceKm: 7, feeRs: 40, estimatedMinutes: 35 },
    ]);

    const result = await service.quoteDeliveryFee(12.9716 + 0.045, 77.5946);

    expect(result?.zoneId).toBe('z2');
  });
});
