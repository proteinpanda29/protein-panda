import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, StockMovementType } from '@prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

interface OrderLineForDeduction {
  productId: string;
  quantity: number;
}

@Injectable()
export class InventoryService {
  private logger = new Logger('InventoryService');

  /**
   * Deducts stock for every ingredient in a product's recipe
   * (ProductIngredient), scaled by how many units were ordered. Runs
   * inside the same transaction as order creation, so it's atomic with
   * the order itself.
   *
   * Deliberately never blocks or throws on missing/insufficient stock —
   * a small shop shouldn't have checkout fail because someone forgot to
   * log a delivery of milk. Stock is allowed to go negative; the
   * low-stock/out-of-stock signal comes from the admin inventory view
   * separately, not from blocking sales.
   *
   * Add-ons are NOT deducted — ProductAddon isn't linked to Ingredient in
   * the schema (addons carry their own price/nutrition deltas directly,
   * not a recipe), so add-on ingredient usage isn't tracked yet.
   */
  /**
   * Deducts stock for every ingredient in a product's recipe
   * (ProductIngredient), scaled by how many units were ordered. Runs
   * inside the same transaction as order creation, so it's atomic with
   * the order itself.
   *
   * Consumes FEFO (First Expiry, First Out): pulls from whichever batch
   * expires soonest first, only moving to the next batch once the
   * current one is exhausted. Batches with no recorded expiry are
   * treated as lowest priority — consumed last, since they carry no
   * spoilage urgency. InventoryItem.quantityOnHand is still kept as the
   * authoritative running total regardless of batch coverage.
   *
   * Deliberately never blocks or throws on missing/insufficient stock —
   * a small shop shouldn't have checkout fail because someone forgot to
   * log a delivery of milk. Stock (and batch remainders) are allowed to
   * go negative/short; the low-stock/expiry signal comes from the admin
   * inventory view separately, not from blocking sales.
   *
   * Add-ons are NOT deducted — ProductAddon isn't linked to Ingredient in
   * the schema (addons carry their own price/nutrition deltas directly,
   * not a recipe), so add-on ingredient usage isn't tracked yet.
   */
  async deductForOrder(tx: Tx, items: OrderLineForDeduction[]) {
    for (const item of items) {
      const recipeLines = await tx.productIngredient.findMany({
        where: { productId: item.productId },
        include: { ingredient: { include: { stock: true } } },
      });

      for (const line of recipeLines) {
        const inventoryItem = line.ingredient.stock;
        if (!inventoryItem) {
          this.logger.warn(
            `No inventory record for ingredient "${line.ingredient.name}" — skipping stock deduction (not blocking the order)`,
          );
          continue;
        }

        const totalDeductAmount = Number(line.quantity) * item.quantity;
        let remaining = totalDeductAmount;

        const batches = await tx.ingredientBatch.findMany({
          where: { ingredientId: line.ingredientId, quantityRemaining: { gt: 0 } },
          orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
        });

        for (const batch of batches) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, Number(batch.quantityRemaining));
          if (take <= 0) continue;

          await tx.ingredientBatch.update({
            where: { id: batch.id },
            data: { quantityRemaining: { decrement: take } },
          });
          await tx.stockMovement.create({
            data: {
              inventoryItemId: inventoryItem.id,
              batchId: batch.id,
              productId: item.productId,
              type: StockMovementType.SALE_DEDUCTION,
              quantity: -take,
              note: `Sale (FEFO — batch ${batch.batchNumber}): ${item.quantity}x order line`,
            },
          });
          remaining -= take;
        }

        // No batch on record (or batches ran short) for part of this
        // deduction — still logged, but not attributed to any batch.
        if (remaining > 0) {
          await tx.stockMovement.create({
            data: {
              inventoryItemId: inventoryItem.id,
              productId: item.productId,
              type: StockMovementType.SALE_DEDUCTION,
              quantity: -remaining,
              note: `Sale: ${item.quantity}x order line (${remaining} ${line.ingredient.unit} had no batch on record)`,
            },
          });
        }

        await tx.inventoryItem.update({
          where: { id: inventoryItem.id },
          data: { quantityOnHand: { decrement: totalDeductAmount } },
        });
      }
    }
  }

  /**
   * The reverse of deductForOrder — restocks whatever a cancelled order's
   * items originally deducted. Used by RefundsService when a full
   * cancellation reverses an order that had already deducted ingredient
   * stock. Same non-blocking philosophy: a missing inventory record is
   * logged and skipped, never thrown.
   *
   * Deliberately aggregate-only: it does NOT re-attribute the restocked
   * quantity back to whichever specific batch(es) it was originally
   * pulled from (a single sale can span multiple batches, and by the
   * time a cancellation happens some of those batches may themselves be
   * gone). Restocked stock becomes generically available via the running
   * total rather than being re-associated with a specific expiry date —
   * a documented simplification, not an oversight.
   */
  async restockForOrder(tx: Tx, orderId: string, items: OrderLineForDeduction[]) {
    for (const item of items) {
      const recipeLines = await tx.productIngredient.findMany({
        where: { productId: item.productId },
        include: { ingredient: { include: { stock: true } } },
      });

      for (const line of recipeLines) {
        const inventoryItem = line.ingredient.stock;
        if (!inventoryItem) {
          this.logger.warn(
            `No inventory record for ingredient "${line.ingredient.name}" — skipping restock (order ${orderId} cancelled)`,
          );
          continue;
        }

        const restockAmount = Number(line.quantity) * item.quantity;

        await tx.inventoryItem.update({
          where: { id: inventoryItem.id },
          data: { quantityOnHand: { increment: restockAmount } },
        });

        await tx.stockMovement.create({
          data: {
            inventoryItemId: inventoryItem.id,
            productId: item.productId,
            type: StockMovementType.REFUND_RESTOCK,
            quantity: restockAmount,
            note: `Cancelled order ${orderId}: ${item.quantity}x order line restocked`,
          },
        });
      }
    }
  }
}
