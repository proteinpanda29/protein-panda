import { InventoryService } from './inventory.service';

function makeTx(recipeByProduct: Record<string, any[]>, batchesByIngredient: Record<string, any[]> = {}) {
  return {
    productIngredient: {
      findMany: jest.fn().mockImplementation(({ where: { productId } }) => Promise.resolve(recipeByProduct[productId] ?? [])),
    },
    inventoryItem: { update: jest.fn().mockResolvedValue({}) },
    stockMovement: { create: jest.fn().mockResolvedValue({}) },
    ingredientBatch: {
      findMany: jest
        .fn()
        .mockImplementation(({ where: { ingredientId } }) => Promise.resolve(batchesByIngredient[ingredientId] ?? [])),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('InventoryService.deductForOrder', () => {
  it('deducts quantity scaled by both recipe amount and order quantity', async () => {
    const tx = makeTx({
      'prod-shake': [
        {
          quantity: 30, // 30g whey per shake
          ingredient: { name: 'Whey', stock: { id: 'inv-whey' } },
        },
      ],
    });
    const service = new InventoryService();

    // 3 shakes ordered → 30g * 3 = 90g deducted
    await service.deductForOrder(tx, [{ productId: 'prod-shake', quantity: 3 }]);

    expect(tx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'inv-whey' },
      data: { quantityOnHand: { decrement: 90 } },
    });
  });

  it('records a StockMovement audit entry with a negative signed quantity', async () => {
    const tx = makeTx({
      'prod-shake': [{ quantity: 30, ingredient: { name: 'Whey', stock: { id: 'inv-whey' } } }],
    });
    const service = new InventoryService();

    await service.deductForOrder(tx, [{ productId: 'prod-shake', quantity: 1 }]);

    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryItemId: 'inv-whey',
        productId: 'prod-shake',
        type: 'SALE_DEDUCTION',
        quantity: -30,
      }),
    });
  });

  it('deducts every ingredient in a multi-ingredient recipe', async () => {
    const tx = makeTx({
      'prod-shake': [
        { quantity: 30, ingredient: { name: 'Whey', stock: { id: 'inv-whey' } } },
        { quantity: 200, ingredient: { name: 'Milk', stock: { id: 'inv-milk' } } },
      ],
    });
    const service = new InventoryService();

    await service.deductForOrder(tx, [{ productId: 'prod-shake', quantity: 1 }]);

    expect(tx.inventoryItem.update).toHaveBeenCalledTimes(2);
  });

  it('never throws when an ingredient has no inventory record yet — skips it instead', async () => {
    const tx = makeTx({
      'prod-shake': [{ quantity: 30, ingredient: { name: 'Whey', stock: null } }],
    });
    const service = new InventoryService();

    await expect(service.deductForOrder(tx, [{ productId: 'prod-shake', quantity: 1 }])).resolves.toBeUndefined();
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('does nothing for a product with no recipe (no ProductIngredient rows)', async () => {
    const tx = makeTx({}); // no recipe registered for any product
    const service = new InventoryService();

    await service.deductForOrder(tx, [{ productId: 'prod-unlinked', quantity: 5 }]);

    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('handles multiple order lines in a single call', async () => {
    const tx = makeTx({
      'prod-shake': [{ quantity: 30, ingredient: { name: 'Whey', stock: { id: 'inv-whey' } } }],
      'prod-oats': [{ quantity: 50, ingredient: { name: 'Oats', stock: { id: 'inv-oats' } } }],
    });
    const service = new InventoryService();

    await service.deductForOrder(tx, [
      { productId: 'prod-shake', quantity: 1 },
      { productId: 'prod-oats', quantity: 2 },
    ]);

    expect(tx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'inv-whey' },
      data: { quantityOnHand: { decrement: 30 } },
    });
    expect(tx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'inv-oats' },
      data: { quantityOnHand: { decrement: 100 } },
    });
  });

  it('consumes FEFO: the earliest-expiring batch is drawn down first', async () => {
    const tx = makeTx(
      {
        'prod-shake': [{ quantity: 30, ingredientId: 'ing-whey', ingredient: { name: 'Whey', unit: 'g', stock: { id: 'inv-whey' } } }],
      },
      {
        'ing-whey': [
          { id: 'batch-1', batchNumber: 'B001', quantityRemaining: 100 }, // findMany already returns in expiry order
        ],
      },
    );
    const service = new InventoryService();

    await service.deductForOrder(tx, [{ productId: 'prod-shake', quantity: 1 }]);

    expect(tx.ingredientBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { quantityRemaining: { decrement: 30 } },
    });
    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ batchId: 'batch-1', quantity: -30, note: expect.stringContaining('B001') }),
    });
  });

  it('spans multiple batches when the first (earliest-expiring) one does not fully cover the deduction', async () => {
    const tx = makeTx(
      {
        'prod-shake': [{ quantity: 30, ingredientId: 'ing-whey', ingredient: { name: 'Whey', unit: 'g', stock: { id: 'inv-whey' } } }],
      },
      {
        // findMany is expected to return these already ordered earliest-expiry first
        'ing-whey': [
          { id: 'batch-1', batchNumber: 'B001', quantityRemaining: 10 },
          { id: 'batch-2', batchNumber: 'B002', quantityRemaining: 100 },
        ],
      },
    );
    const service = new InventoryService();

    await service.deductForOrder(tx, [{ productId: 'prod-shake', quantity: 1 }]); // needs 30g total

    expect(tx.ingredientBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { quantityRemaining: { decrement: 10 } },
    });
    expect(tx.ingredientBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-2' },
      data: { quantityRemaining: { decrement: 20 } },
    });
  });

  it('queries batches ordered earliest-expiry-first, with null expiry sorted last', async () => {
    const tx = makeTx({
      'prod-shake': [{ quantity: 30, ingredientId: 'ing-whey', ingredient: { name: 'Whey', unit: 'g', stock: { id: 'inv-whey' } } }],
    });
    const service = new InventoryService();

    await service.deductForOrder(tx, [{ productId: 'prod-shake', quantity: 1 }]);

    expect(tx.ingredientBatch.findMany).toHaveBeenCalledWith({
      where: { ingredientId: 'ing-whey', quantityRemaining: { gt: 0 } },
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
    });
  });

  it('falls back to an unattributed deduction (no batchId) when no batch covers the amount — still deducts the aggregate total', async () => {
    const tx = makeTx({
      'prod-shake': [{ quantity: 30, ingredientId: 'ing-whey', ingredient: { name: 'Whey', unit: 'g', stock: { id: 'inv-whey' } } }],
    }); // no batches registered for ing-whey
    const service = new InventoryService();

    await service.deductForOrder(tx, [{ productId: 'prod-shake', quantity: 1 }]);

    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: -30, note: expect.stringContaining('no batch on record') }),
    });
    expect(tx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'inv-whey' },
      data: { quantityOnHand: { decrement: 30 } },
    });
  });
});

describe('InventoryService.restockForOrder', () => {
  it('increments stock scaled by recipe amount and order quantity — the reverse of deductForOrder', async () => {
    const tx = makeTx({
      'prod-shake': [{ quantity: 30, ingredient: { name: 'Whey', stock: { id: 'inv-whey' } } }],
    });
    const service = new InventoryService();

    await service.restockForOrder(tx, 'order-1', [{ productId: 'prod-shake', quantity: 3 }]);

    expect(tx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'inv-whey' },
      data: { quantityOnHand: { increment: 90 } },
    });
  });

  it('records a StockMovement with type REFUND_RESTOCK and a positive signed quantity', async () => {
    const tx = makeTx({
      'prod-shake': [{ quantity: 30, ingredient: { name: 'Whey', stock: { id: 'inv-whey' } } }],
    });
    const service = new InventoryService();

    await service.restockForOrder(tx, 'order-1', [{ productId: 'prod-shake', quantity: 1 }]);

    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryItemId: 'inv-whey',
        productId: 'prod-shake',
        type: 'REFUND_RESTOCK',
        quantity: 30,
      }),
    });
  });

  it('never throws when an ingredient has no inventory record — skips it instead', async () => {
    const tx = makeTx({
      'prod-shake': [{ quantity: 30, ingredient: { name: 'Whey', stock: null } }],
    });
    const service = new InventoryService();

    await expect(
      service.restockForOrder(tx, 'order-1', [{ productId: 'prod-shake', quantity: 1 }]),
    ).resolves.toBeUndefined();
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });
});
