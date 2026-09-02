import { SuppliersService } from './suppliers.service';

function makeHarness() {
  const prisma: any = {
    supplier: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn() },
    purchase: { findMany: jest.fn(), create: jest.fn() },
    inventoryItem: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    ingredientBatch: { create: jest.fn().mockResolvedValue({ id: 'batch-1' }) },
    stockMovement: { create: jest.fn() },
    ingredient: { update: jest.fn() },
    purchaseRequest: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), findUniqueOrThrow: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = jest.fn().mockImplementation((cb: any) => cb(prisma));

  const service = new SuppliersService(prisma);
  return { service, prisma };
}

describe('SuppliersService.createSupplier', () => {
  it('rejects a missing name', async () => {
    const { service } = makeHarness();
    await expect(service.createSupplier({ name: '' })).rejects.toThrow(/name is required/);
  });

  it('creates a supplier with a trimmed name', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.create.mockResolvedValue({});

    await service.createSupplier({ name: '  ABC Traders  ', phone: '9876543210' });

    expect(prisma.supplier.create).toHaveBeenCalledWith({
      data: { name: 'ABC Traders', phone: '9876543210' },
    });
  });
});

describe('SuppliersService.createPurchase', () => {
  const validLine = { ingredientId: 'ing-1', quantity: 10, unitCostRs: 40 };

  it('rejects a purchase with no line items', async () => {
    const { service } = makeHarness();
    await expect(service.createPurchase({ supplierId: 'sup-1', lines: [] })).rejects.toThrow(
      /at least one line item/,
    );
  });

  it('rejects a line with non-positive quantity', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ABC' });

    await expect(
      service.createPurchase({ supplierId: 'sup-1', lines: [{ ...validLine, quantity: 0 }] }),
    ).rejects.toThrow(/quantity must be positive/);
  });

  it('rejects a line with negative unit cost', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ABC' });

    await expect(
      service.createPurchase({ supplierId: 'sup-1', lines: [{ ...validLine, unitCostRs: -1 }] }),
    ).rejects.toThrow(/cannot be negative/);
  });

  it('computes the total amount as the sum of quantity × unitCost across all lines', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ABC' });
    prisma.purchase.create.mockResolvedValue({ id: 'purchase-1', lines: [] });
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1' });

    await service.createPurchase({
      supplierId: 'sup-1',
      lines: [
        { ingredientId: 'ing-1', quantity: 10, unitCostRs: 40 }, // 400
        { ingredientId: 'ing-2', quantity: 5, unitCostRs: 20 }, // 100
      ],
    });

    expect(prisma.purchase.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalAmountRs: 500 }) }),
    );
  });

  it('creates a new InventoryItem when the ingredient has none yet', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ABC' });
    prisma.purchase.create.mockResolvedValue({ id: 'purchase-1', lines: [] });
    prisma.inventoryItem.findUnique.mockResolvedValue(null);
    prisma.inventoryItem.create.mockResolvedValue({ id: 'inv-new' });

    await service.createPurchase({ supplierId: 'sup-1', lines: [validLine] });

    expect(prisma.inventoryItem.create).toHaveBeenCalledWith({
      data: { ingredientId: 'ing-1', quantityOnHand: 0, reorderLevel: 0 },
    });
  });

  it('creates an IngredientBatch for each line, tagged with the supplier name', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ABC Traders' });
    prisma.purchase.create.mockResolvedValue({ id: 'purchase-1', lines: [] });
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1' });

    await service.createPurchase({
      supplierId: 'sup-1',
      lines: [{ ingredientId: 'ing-1', quantity: 10, unitCostRs: 40, batchNumber: 'B100', expiryDate: '2026-12-01' }],
    });

    expect(prisma.ingredientBatch.create).toHaveBeenCalledWith({
      data: {
        ingredientId: 'ing-1',
        batchNumber: 'B100',
        supplierName: 'ABC Traders',
        quantityReceived: 10,
        quantityRemaining: 10,
        expiryDate: new Date('2026-12-01'),
      },
    });
  });

  it('increments InventoryItem.quantityOnHand for every line', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ABC' });
    prisma.purchase.create.mockResolvedValue({ id: 'purchase-1', lines: [] });
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1' });

    await service.createPurchase({ supplierId: 'sup-1', lines: [validLine] });

    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { quantityOnHand: { increment: 10 } },
    });
  });

  it('updates the ingredient running cost to the price just paid', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ABC' });
    prisma.purchase.create.mockResolvedValue({ id: 'purchase-1', lines: [] });
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1' });

    await service.createPurchase({ supplierId: 'sup-1', lines: [{ ingredientId: 'ing-1', quantity: 10, unitCostRs: 42.5 }] });

    expect(prisma.ingredient.update).toHaveBeenCalledWith({
      where: { id: 'ing-1' },
      data: { costPerUnitRs: 42.5 },
    });
  });

  it('auto-generates a batch number from the purchase id when none is given', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ABC' });
    prisma.purchase.create.mockResolvedValue({ id: 'purchase-12345678', lines: [] });
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1' });

    await service.createPurchase({ supplierId: 'sup-1', lines: [validLine] });

    expect(prisma.ingredientBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ batchNumber: expect.stringContaining('PO-') }) }),
    );
  });

  it('logs a RESTOCK stock movement referencing the supplier and invoice number', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ABC Traders' });
    prisma.purchase.create.mockResolvedValue({ id: 'purchase-1', lines: [] });
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1' });

    await service.createPurchase({ supplierId: 'sup-1', invoiceNumber: 'INV-99', lines: [validLine] });

    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryItemId: 'inv-1',
        type: 'RESTOCK',
        quantity: 10,
        note: expect.stringContaining('INV-99'),
      }),
    });
  });
});

describe('SuppliersService.createPurchaseRequest', () => {
  it('rejects a non-positive requested quantity', async () => {
    const { service } = makeHarness();
    await expect(service.createPurchaseRequest('user-1', { ingredientId: 'ing-1', requestedQty: 0 })).rejects.toThrow(/must be positive/);
  });

  it('creates a real request attributed to the requesting user, starting PENDING', async () => {
    const { service, prisma } = makeHarness();

    await service.createPurchaseRequest('user-1', { ingredientId: 'ing-1', requestedQty: 5000, note: 'Running low' });

    expect(prisma.purchaseRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ingredientId: 'ing-1', requestedQty: 5000, requestedByUserId: 'user-1' }) }),
    );
  });
});

describe('SuppliersService.decidePurchaseRequest — separation of duties', () => {
  it('refuses to let the requester approve their own request — the real enforced rule, not just a UI convention', async () => {
    const { service, prisma } = makeHarness();
    prisma.purchaseRequest.findUniqueOrThrow.mockResolvedValue({ id: 'req-1', status: 'PENDING', requestedByUserId: 'user-1' });

    await expect(service.decidePurchaseRequest('user-1', 'req-1', 'APPROVED')).rejects.toThrow(/cannot approve your own/);
  });

  it('allows a different user to approve it', async () => {
    const { service, prisma } = makeHarness();
    prisma.purchaseRequest.findUniqueOrThrow.mockResolvedValue({ id: 'req-1', status: 'PENDING', requestedByUserId: 'user-1' });

    await service.decidePurchaseRequest('user-2', 'req-1', 'APPROVED');

    expect(prisma.purchaseRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', approvedByUserId: 'user-2' }) }),
    );
  });

  it('refuses to decide a request that has already been decided', async () => {
    const { service, prisma } = makeHarness();
    prisma.purchaseRequest.findUniqueOrThrow.mockResolvedValue({ id: 'req-1', status: 'APPROVED', requestedByUserId: 'user-1' });

    await expect(service.decidePurchaseRequest('user-2', 'req-1', 'APPROVED')).rejects.toThrow(/already been decided/);
  });

  it('requires a reason when rejecting', async () => {
    const { service, prisma } = makeHarness();
    prisma.purchaseRequest.findUniqueOrThrow.mockResolvedValue({ id: 'req-1', status: 'PENDING', requestedByUserId: 'user-1' });

    await expect(service.decidePurchaseRequest('user-2', 'req-1', 'REJECTED')).rejects.toThrow(/reason is required/);
  });

  it('records the rejection reason when rejecting with one', async () => {
    const { service, prisma } = makeHarness();
    prisma.purchaseRequest.findUniqueOrThrow.mockResolvedValue({ id: 'req-1', status: 'PENDING', requestedByUserId: 'user-1' });

    await service.decidePurchaseRequest('user-2', 'req-1', 'REJECTED', 'Budget too tight this month');

    expect(prisma.purchaseRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'Budget too tight this month' }) }),
    );
  });
});

describe('SuppliersService.createPurchase — fulfilling an approved request', () => {
  it('refuses to fulfill a request that has not actually been approved', async () => {
    const { service, prisma } = makeHarness();
    prisma.purchaseRequest.findUniqueOrThrow.mockResolvedValue({ id: 'req-1', status: 'PENDING' });

    await expect(
      service.createPurchase({
        supplierId: 'sup-1',
        lines: [{ ingredientId: 'ing-1', quantity: 100, unitCostRs: 5 }],
        fulfillsRequestId: 'req-1',
      }),
    ).rejects.toThrow(/Only an approved request/);
  });

  it('marks the request FULFILLED and links it to the real purchase once goods are received', async () => {
    const { service, prisma } = makeHarness();
    prisma.purchaseRequest.findUniqueOrThrow.mockResolvedValue({ id: 'req-1', status: 'APPROVED' });
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ProteinCo' });
    prisma.purchase.create.mockResolvedValue({ id: 'purchase-1', lines: [] });
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1', ingredientId: 'ing-1' });

    await service.createPurchase({
      supplierId: 'sup-1',
      lines: [{ ingredientId: 'ing-1', quantity: 100, unitCostRs: 5 }],
      fulfillsRequestId: 'req-1',
    });

    expect(prisma.purchaseRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: 'FULFILLED', fulfilledPurchaseId: 'purchase-1' },
    });
  });

  it('does not touch any purchase request at all for a normal purchase with no fulfillsRequestId', async () => {
    const { service, prisma } = makeHarness();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue({ id: 'sup-1', name: 'ProteinCo' });
    prisma.purchase.create.mockResolvedValue({ id: 'purchase-1', lines: [] });
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1', ingredientId: 'ing-1' });

    await service.createPurchase({ supplierId: 'sup-1', lines: [{ ingredientId: 'ing-1', quantity: 100, unitCostRs: 5 }] });

    expect(prisma.purchaseRequest.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
  });
});
