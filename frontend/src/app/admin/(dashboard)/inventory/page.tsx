'use client';

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface InventoryItem {
  id: string;
  ingredientId: string;
  quantityOnHand: string;
  reorderLevel: string;
  updatedAt: string;
  ingredient: { name: string; unit: string };
}

interface StockMovement {
  id: string;
  type: string;
  quantity: string;
  note: string | null;
  createdAt: string;
  inventoryItem: { ingredient: { name: string; unit: string } };
  product: { name: string } | null;
}

interface ExpiringBatch {
  id: string;
  batchNumber: string;
  quantityRemaining: string;
  expiryDate: string;
  ingredient: { id: string; name: string; unit: string };
}

function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function AdminInventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [expiring, setExpiring] = useState<ExpiringBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [wastageBatchId, setWastageBatchId] = useState<string | null>(null);

  const load = () => {
    api.adminInventory().then(setItems).catch((err) => setError(err.message));
    api.adminStockMovements().then(setMovements).catch(() => undefined);
    api.adminExpiringBatches(3).then(setExpiring).catch(() => undefined);
  };

  useEffect(load, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Inventory</h1>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          {showAddForm ? 'Cancel' : '+ Add Ingredient'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {expiring.length > 0 && (
        <div className="mb-6 rounded-2xl border-2 border-red-300 bg-red-50 p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-red-700">⚠️ Expiring Soon</h2>
          <div className="flex flex-col gap-2">
            {expiring.map((b) => {
              const days = daysUntil(b.expiryDate);
              return (
                <div key={b.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                  <span>
                    {b.ingredient.name} — batch {b.batchNumber} — {b.quantityRemaining} {b.ingredient.unit} remaining
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${days <= 0 ? 'text-red-700' : 'text-yellow-700'}`}>
                      {days <= 0 ? 'Expired' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`}
                    </span>
                    <button
                      onClick={() => setWastageBatchId(wastageBatchId === b.id ? null : b.id)}
                      className="text-xs font-bold uppercase text-red-600 underline"
                    >
                      Log Waste
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {wastageBatchId && (
            <WastageForm
              batch={expiring.find((b) => b.id === wastageBatchId)!}
              onDone={() => {
                setWastageBatchId(null);
                load();
              }}
            />
          )}
        </div>
      )}

      {showAddForm && (
        <AddIngredientForm
          onDone={() => {
            setShowAddForm(false);
            load();
          }}
        />
      )}

      <div className="mb-8 overflow-hidden rounded-2xl border border-brand-grey bg-brand-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-black text-brand-white">
            <tr>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Ingredient</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">On Hand</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Reorder At</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const onHand = Number(item.quantityOnHand);
              const reorder = Number(item.reorderLevel);
              const low = onHand <= reorder;
              return (
                <Fragment key={item.id}>
                  <tr className="border-t border-brand-grey">
                    <td className="px-4 py-3 font-semibold text-brand-black">{item.ingredient.name}</td>
                    <td className="px-4 py-3 text-brand-body">
                      {onHand.toLocaleString()} {item.ingredient.unit}
                    </td>
                    <td className="px-4 py-3 text-brand-body">
                      {reorder.toLocaleString()} {item.ingredient.unit}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${
                          low ? 'bg-red-100 text-red-700' : 'bg-brand-primary/10 text-brand-primary'
                        }`}
                      >
                        {low ? '⚠️ Low Stock' : '✓ OK'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setRestockingId(restockingId === item.id ? null : item.id)}
                        className="text-xs font-bold uppercase text-brand-primary underline"
                      >
                        Restock
                      </button>
                    </td>
                  </tr>
                  {restockingId === item.id && (
                    <tr className="border-t border-brand-grey bg-brand-bg">
                      <td colSpan={5} className="px-4 py-3">
                        <RestockForm
                          item={item}
                          onDone={() => {
                            setRestockingId(null);
                            load();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {items.length === 0 && <p className="p-4 text-sm text-brand-body">No ingredients tracked yet.</p>}
      </div>

      <h2 className="mb-3 text-lg font-extrabold uppercase tracking-tight text-brand-black">Recent Stock Movements</h2>
      <div className="rounded-2xl border border-brand-grey bg-brand-white">
        {movements.length === 0 ? (
          <p className="p-4 text-sm text-brand-body">No stock movements yet.</p>
        ) : (
          <ul className="divide-y divide-brand-grey">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-semibold text-brand-black">{m.inventoryItem.ingredient.name}</p>
                  <p className="text-xs text-brand-body">
                    {m.type.replace(/_/g, ' ')} {m.product ? `· ${m.product.name}` : ''} · {new Date(m.createdAt).toLocaleString()}
                  </p>
                  {m.note && <p className="text-xs text-brand-body">{m.note}</p>}
                </div>
                <span className={`font-bold ${Number(m.quantity) < 0 ? 'text-red-600' : 'text-brand-primary'}`}>
                  {Number(m.quantity) > 0 ? '+' : ''}
                  {m.quantity} {m.inventoryItem.ingredient.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AddIngredientForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('g');
  const [initialQuantity, setInitialQuantity] = useState('');
  const [reorderLevel, setReorderLevel] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateIngredient({
        name,
        unit,
        initialQuantity: Number(initialQuantity),
        reorderLevel: Number(reorderLevel),
        batchNumber: batchNumber || undefined,
        expiryDate: expiryDate || undefined,
        supplierName: supplierName || undefined,
      });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-brand-grey bg-brand-white p-5 sm:grid-cols-4">
      <input
        placeholder="Ingredient name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
      />
      <select value={unit} onChange={(e) => setUnit(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm">
        <option value="g">grams (g)</option>
        <option value="ml">millilitres (ml)</option>
        <option value="pcs">pieces (pcs)</option>
      </select>
      <input
        type="number"
        placeholder="Starting stock"
        value={initialQuantity}
        onChange={(e) => setInitialQuantity(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <input
        type="number"
        placeholder="Reorder level"
        value={reorderLevel}
        onChange={(e) => setReorderLevel(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
      />
      <input
        placeholder="Batch # (optional)"
        value={batchNumber}
        onChange={(e) => setBatchNumber(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <label className="text-xs font-semibold text-brand-body">
        Expiry date (optional)
        <input
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
      </label>
      <input
        placeholder="Supplier (optional)"
        value={supplierName}
        onChange={(e) => setSupplierName(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
      />
      {error && <p className="text-xs text-red-600 sm:col-span-4">{error}</p>}
      <button
        onClick={submit}
        disabled={saving || !name || !initialQuantity || !reorderLevel}
        className="rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50 sm:col-span-4"
      >
        {saving ? 'Saving…' : 'Add Ingredient'}
      </button>
    </div>
  );
}

function RestockForm({ item, onDone }: { item: InventoryItem; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isRestock = Number(amount) > 0;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminRestock(item.id, Number(amount), note || undefined, isRestock ? { batchNumber, expiryDate, supplierName } : undefined);
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          placeholder={`Amount (${item.ingredient.unit}, negative to correct down)`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-64 rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <input
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="flex-1 rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
      </div>
      {isRestock && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            placeholder="Batch # (optional)"
            value={batchNumber}
            onChange={(e) => setBatchNumber(e.target.value)}
            className="w-40 rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
            title="Expiry date (optional but recommended)"
          />
          <input
            placeholder="Supplier (optional)"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            className="flex-1 rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
        </div>
      )}
      <div>
        <button
          onClick={submit}
          disabled={saving || !amount}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Confirm'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function WastageForm({ batch, onDone }: { batch: ExpiringBatch; onDone: () => void }) {
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('Expired');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminRecordWastage(batch.id, Number(quantity), reason);
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-white p-3">
      <span className="text-xs text-brand-body">
        Logging waste for {batch.ingredient.name} (batch {batch.batchNumber}, max {batch.quantityRemaining} {batch.ingredient.unit}):
      </span>
      <input
        type="number"
        placeholder={`Qty (${batch.ingredient.unit})`}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        max={batch.quantityRemaining}
        className="w-28 rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm">
        <option>Expired</option>
        <option>Spoiled</option>
        <option>Damaged</option>
        <option>Over-prepared</option>
      </select>
      <button
        onClick={submit}
        disabled={saving || !quantity}
        className="rounded-full bg-red-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-red-700 disabled:opacity-50"
      >
        {saving ? 'Logging…' : 'Log Waste'}
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}
