'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  gstNumber: string | null;
  paymentTerms: string | null;
  isActive: boolean;
}

interface Ingredient {
  id: string;
  name: string;
  unit: string;
}

interface PurchaseLine {
  id: string;
  quantity: string;
  unitCostRs: string;
  batchNumber: string | null;
  expiryDate: string | null;
  ingredient: { name: string; unit: string };
}

interface Purchase {
  id: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  totalAmountRs: string;
  supplier: { name: string };
  lines: PurchaseLine[];
}

export default function AdminSuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);

  const load = () => {
    api.adminSuppliers().then(setSuppliers).catch((err) => setError(err.message));
    api.adminPurchases().then(setPurchases).catch(() => undefined);
    api.adminIngredients().then(setIngredients).catch(() => undefined);
  };

  useEffect(load, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Suppliers & Purchases</h1>
        <div className="flex gap-2">
          <a href="/admin/costing" className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary">
            View Costing
          </a>
          <button
            onClick={() => setShowSupplierForm((v) => !v)}
            className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary"
          >
            {showSupplierForm ? 'Cancel' : '+ Supplier'}
          </button>
          <button
            onClick={() => setShowPurchaseForm((v) => !v)}
            className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent"
          >
            {showPurchaseForm ? 'Cancel' : '+ Record Purchase'}
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {showSupplierForm && (
        <SupplierForm
          onDone={() => {
            setShowSupplierForm(false);
            load();
          }}
        />
      )}

      {showPurchaseForm && (
        <PurchaseForm
          suppliers={suppliers}
          ingredients={ingredients}
          onDone={() => {
            setShowPurchaseForm(false);
            load();
          }}
        />
      )}

      <h2 className="mb-3 text-lg font-extrabold uppercase tracking-tight text-brand-black">Suppliers</h2>
      <div className="mb-8 flex flex-col gap-2">
        {suppliers.map((s) => (
          <div key={s.id} className="rounded-2xl border border-brand-grey bg-brand-white p-4">
            <p className="font-bold text-brand-black">{s.name}</p>
            <p className="text-xs text-brand-body">
              {[s.phone, s.address, s.gstNumber && `GST: ${s.gstNumber}`, s.paymentTerms].filter(Boolean).join(' · ')}
            </p>
          </div>
        ))}
        {suppliers.length === 0 && <p className="text-sm text-brand-body">No suppliers yet.</p>}
      </div>

      <h2 className="mb-3 text-lg font-extrabold uppercase tracking-tight text-brand-black">Purchase History</h2>
      <div className="flex flex-col gap-3">
        {purchases.map((p) => (
          <div key={p.id} className="rounded-2xl border border-brand-grey bg-brand-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-bold text-brand-black">
                {p.supplier.name} {p.invoiceNumber && `· Invoice ${p.invoiceNumber}`}
              </p>
              <p className="font-bold text-brand-primary">₹{p.totalAmountRs}</p>
            </div>
            <p className="mb-2 text-xs text-brand-body">{new Date(p.purchaseDate).toLocaleDateString()}</p>
            <ul className="flex flex-col gap-1">
              {p.lines.map((l) => (
                <li key={l.id} className="text-xs text-brand-body">
                  {l.quantity} {l.ingredient.unit} {l.ingredient.name} @ ₹{l.unitCostRs}/{l.ingredient.unit}
                  {l.batchNumber && ` · batch ${l.batchNumber}`}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {purchases.length === 0 && <p className="text-sm text-brand-body">No purchases recorded yet.</p>}
      </div>
    </div>
  );
}

function SupplierForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateSupplier({
        name,
        phone: phone || undefined,
        address: address || undefined,
        gstNumber: gstNumber || undefined,
        paymentTerms: paymentTerms || undefined,
      });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-brand-grey bg-brand-white p-5 sm:grid-cols-2">
      <input placeholder="Supplier name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2" />
      <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
      <input placeholder="GST number (optional)" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
      <input placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2" />
      <input placeholder="Payment terms (e.g. Net 15)" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2" />
      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}
      <button onClick={submit} disabled={saving || !name.trim()} className="rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50 sm:col-span-2">
        {saving ? 'Saving…' : 'Add Supplier'}
      </button>
    </div>
  );
}

interface DraftLine {
  ingredientId: string;
  quantity: string;
  unitCostRs: string;
  batchNumber: string;
  expiryDate: string;
}

function PurchaseForm({ suppliers, ingredients, onDone }: { suppliers: Supplier[]; ingredients: Ingredient[]; onDone: () => void }) {
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DraftLine[]>([{ ingredientId: '', quantity: '', unitCostRs: '', batchNumber: '', expiryDate: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateLine = (idx: number, field: keyof DraftLine, value: string) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCostRs) || 0), 0);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminCreatePurchase({
        supplierId,
        invoiceNumber: invoiceNumber || undefined,
        purchaseDate,
        lines: lines
          .filter((l) => l.ingredientId && l.quantity && l.unitCostRs)
          .map((l) => ({
            ingredientId: l.ingredientId,
            quantity: Number(l.quantity),
            unitCostRs: Number(l.unitCostRs),
            batchNumber: l.batchNumber || undefined,
            expiryDate: l.expiryDate || undefined,
          })),
      });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm">
          <option value="">Supplier…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input placeholder="Invoice # (optional)" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
        <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
      </div>

      <p className="mb-2 text-xs font-bold uppercase text-brand-body">Line Items</p>
      <div className="mb-3 flex flex-col gap-2">
        {lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <select value={line.ingredientId} onChange={(e) => updateLine(idx, 'ingredientId', e.target.value)} className="rounded-lg border border-brand-grey px-2 py-2 text-sm">
              <option value="">Ingredient…</option>
              {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
            </select>
            <input type="number" placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', e.target.value)} className="rounded-lg border border-brand-grey px-2 py-2 text-sm" />
            <input type="number" placeholder="₹/unit" value={line.unitCostRs} onChange={(e) => updateLine(idx, 'unitCostRs', e.target.value)} className="rounded-lg border border-brand-grey px-2 py-2 text-sm" />
            <input placeholder="Batch #" value={line.batchNumber} onChange={(e) => updateLine(idx, 'batchNumber', e.target.value)} className="rounded-lg border border-brand-grey px-2 py-2 text-sm" />
            <input type="date" value={line.expiryDate} onChange={(e) => updateLine(idx, 'expiryDate', e.target.value)} className="rounded-lg border border-brand-grey px-2 py-2 text-sm" />
          </div>
        ))}
      </div>
      <button
        onClick={() => setLines((prev) => [...prev, { ingredientId: '', quantity: '', unitCostRs: '', batchNumber: '', expiryDate: '' }])}
        className="mb-3 text-xs font-bold uppercase text-brand-primary underline"
      >
        + Add another line
      </button>

      <p className="mb-2 text-sm font-bold text-brand-black">Total: ₹{total.toFixed(2)}</p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={saving || !supplierId}
        className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Record Purchase'}
      </button>
    </div>
  );
}
