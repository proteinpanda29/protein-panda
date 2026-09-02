import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface PurchaseLineInput {
  ingredientId: string;
  quantity: number;
  unitCostRs: number;
  batchNumber?: string;
  expiryDate?: string;
}

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async listSuppliers() {
    return this.prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  }

  async createSupplier(data: { name: string; phone?: string; address?: string; gstNumber?: string; paymentTerms?: string }) {
    if (!data.name?.trim()) throw new BadRequestException('Supplier name is required');
    return this.prisma.supplier.create({ data: { ...data, name: data.name.trim() } });
  }

  async updateSupplier(id: string, data: Partial<{ name: string; phone: string; address: string; gstNumber: string; paymentTerms: string; isActive: boolean }>) {
    return this.prisma.supplier.update({ where: { id }, data });
  }

  async listPurchases(supplierId?: string) {
    return this.prisma.purchase.findMany({
      where: supplierId ? { supplierId } : undefined,
      orderBy: { purchaseDate: 'desc' },
      include: { supplier: { select: { name: true } }, lines: { include: { ingredient: { select: { name: true, unit: true } } } } },
    });
  }

  /**
   * Records a supplier delivery: creates the Purchase + line items, an
   * IngredientBatch per line (so FEFO/expiry tracking has real data,
   * not just admin-guessed manual restocks), bumps
   * InventoryItem.quantityOnHand, and updates each ingredient's running
   * cost estimate to the price just paid — the basis for product costing.
   */
  async createPurchase(data: {
    supplierId: string;
    invoiceNumber?: string;
    purchaseDate?: string;
    lines: PurchaseLineInput[];
    // Optional — when this purchase is fulfilling an approved
    // PurchaseRequest (goods have arrived for something that was
    // requested and approved earlier), pass its id here to close the
    // loop: the request moves to FULFILLED and links to the real
    // purchase record created below, rather than staying open forever.
    fulfillsRequestId?: string;
  }) {
    if (!data.lines?.length) throw new BadRequestException('A purchase needs at least one line item');
    for (const line of data.lines) {
      if (line.quantity <= 0) throw new BadRequestException('Each line quantity must be positive');
      if (line.unitCostRs < 0) throw new BadRequestException('Unit cost cannot be negative');
    }

    if (data.fulfillsRequestId) {
      const request = await this.prisma.purchaseRequest.findUniqueOrThrow({ where: { id: data.fulfillsRequestId } });
      if (request.status !== 'APPROVED') throw new BadRequestException('Only an approved request can be fulfilled');
    }

    const supplier = await this.prisma.supplier.findUniqueOrThrow({ where: { id: data.supplierId } });
    const totalAmountRs = data.lines.reduce((sum, l) => sum + l.quantity * l.unitCostRs, 0);
    const purchaseDate = data.purchaseDate ? new Date(data.purchaseDate) : new Date();

    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          supplierId: data.supplierId,
          invoiceNumber: data.invoiceNumber,
          purchaseDate,
          totalAmountRs,
          lines: {
            create: data.lines.map((l) => ({
              ingredientId: l.ingredientId,
              quantity: l.quantity,
              unitCostRs: l.unitCostRs,
              batchNumber: l.batchNumber,
              expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
            })),
          },
        },
        include: { lines: true },
      });

      for (const line of data.lines) {
        let inventoryItem = await tx.inventoryItem.findUnique({ where: { ingredientId: line.ingredientId } });
        if (!inventoryItem) {
          inventoryItem = await tx.inventoryItem.create({
            data: { ingredientId: line.ingredientId, quantityOnHand: 0, reorderLevel: 0 },
          });
        }

        const batch = await tx.ingredientBatch.create({
          data: {
            ingredientId: line.ingredientId,
            batchNumber: line.batchNumber?.trim() || `PO-${purchase.id.slice(0, 8)}`,
            supplierName: supplier.name,
            quantityReceived: line.quantity,
            quantityRemaining: line.quantity,
            expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
          },
        });

        await tx.inventoryItem.update({
          where: { id: inventoryItem.id },
          data: { quantityOnHand: { increment: line.quantity } },
        });

        await tx.stockMovement.create({
          data: {
            inventoryItemId: inventoryItem.id,
            batchId: batch.id,
            type: 'RESTOCK',
            quantity: line.quantity,
            note: `Purchase from ${supplier.name}${data.invoiceNumber ? ` — invoice ${data.invoiceNumber}` : ''}`,
          },
        });

        // Last price paid becomes the current cost estimate for this ingredient.
        await tx.ingredient.update({
          where: { id: line.ingredientId },
          data: { costPerUnitRs: line.unitCostRs },
        });
      }

      if (data.fulfillsRequestId) {
        await tx.purchaseRequest.update({
          where: { id: data.fulfillsRequestId },
          data: { status: 'FULFILLED', fulfilledPurchaseId: purchase.id },
        });
      }

      return purchase;
    });
  }

  // ---------------------------------------------------------
  // PURCHASE REQUEST → APPROVAL — precedes createPurchase above.
  // Separation of duties is enforced here, not just documented: the
  // person who raised the request can never be the one who approves
  // it, even if they otherwise have full Supply Chain access.
  // ---------------------------------------------------------

  async createPurchaseRequest(userId: string, data: { ingredientId: string; requestedQty: number; note?: string }) {
    if (data.requestedQty <= 0) throw new BadRequestException('Requested quantity must be positive');
    return this.prisma.purchaseRequest.create({
      data: {
        ingredientId: data.ingredientId,
        requestedQty: data.requestedQty,
        note: data.note,
        requestedByUserId: userId,
      },
      include: { ingredient: true },
    });
  }

  async listPurchaseRequests(status?: string) {
    return this.prisma.purchaseRequest.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        ingredient: true,
        requestedByUser: { select: { staff: { select: { name: true } } } },
        approvedByUser: { select: { staff: { select: { name: true } } } },
      },
    });
  }

  async decidePurchaseRequest(approverUserId: string, requestId: string, decision: 'APPROVED' | 'REJECTED', rejectionReason?: string) {
    const request = await this.prisma.purchaseRequest.findUniqueOrThrow({ where: { id: requestId } });

    if (request.status !== 'PENDING') throw new BadRequestException('This request has already been decided');
    // The real separation-of-duties check — not a UI convention, an
    // enforced rule: whoever raised the request cannot be the one
    // approving their own spending.
    if (request.requestedByUserId === approverUserId) {
      throw new ForbiddenException('You cannot approve your own purchase request — a different approver is required');
    }
    if (decision === 'REJECTED' && !rejectionReason?.trim()) {
      throw new BadRequestException('A reason is required when rejecting a request');
    }

    return this.prisma.purchaseRequest.update({
      where: { id: requestId },
      data: {
        status: decision,
        approvedByUserId: approverUserId,
        decidedAt: new Date(),
        rejectionReason: decision === 'REJECTED' ? rejectionReason : null,
      },
    });
  }
}
