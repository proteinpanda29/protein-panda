'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Category {
  id: string;
  name: string;
}

interface ProductRow {
  id: string;
  name: string;
  basePriceRs: string;
  isActive: boolean;
  isVeg: boolean;
  category: { name: string };
  nutrition: { proteinG: string; calories: number } | null;
}

export default function AdminProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [form, setForm] = useState({
    name: '',
    categoryId: '',
    basePriceRs: '',
    isVeg: true,
    proteinG: '',
    calories: '',
    prepTimeMinutes: '',
  });
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ deleted: number; skipped: number; results: { id: string; name: string | null; status: string; reason?: string }[] } | null>(null);

  const load = () => {
    Promise.all([api.adminProducts(), api.adminCategories()])
      .then(([p, c]) => {
        setProducts(p);
        setCategories(c);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const toggleActive = async (product: ProductRow) => {
    try {
      await api.adminUpdateProduct(product.id, { isActive: !product.isActive });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteProduct = async (product: ProductRow) => {
    if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return;
    try {
      await api.adminDeleteProduct(product.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === products.length ? new Set() : new Set(products.map((p) => p.id))));
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected product(s)? Any with existing orders will be skipped automatically — use "Disable" for those instead.`)) return;
    setBulkDeleting(true);
    setError(null);
    setBulkResult(null);
    try {
      const result = await api.adminBulkDeleteProducts([...selectedIds]);
      setBulkResult(result);
      setSelectedIds(new Set());
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkDeleting(false);
    }
  };
    const bulkSetActive = async (isActive: boolean) => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${isActive ? 'Enable' : 'Disable'} ${selectedIds.size} selected product(s)? ${isActive ? 'They will show on the menu again.' : 'They will be hidden from the menu — nothing is deleted, and you can turn them back on anytime.'}`)) return;
    setBulkDeleting(true);
    setError(null);
    setBulkResult(null);
    try {
      await api.adminBulkSetProductsActive([...selectedIds], isActive);
      setSelectedIds(new Set());
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  const deleteCategory = async (category: Category) => {
    if (!confirm(`Delete category "${category.name}"? This only works if it has no products in it.`)) return;
    try {
      await api.adminDeleteCategory(category.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Grouped by category — the same organization the customer-facing
  // menu now uses, so admins browse products the same way customers
  // will actually see them, rather than one long undifferentiated list.
  const productsByCategory = new Map<string, ProductRow[]>();
  for (const p of products) {
    const name = p.category.name;
    if (!productsByCategory.has(name)) productsByCategory.set(name, []);
    productsByCategory.get(name)!.push(p);
  }
  const categoryNames = Array.from(productsByCategory.keys()).sort();

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const submitCategory = async () => {
    if (!newCategoryName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateCategory({ name: newCategoryName, slug: slugify(newCategoryName) });
      setNewCategoryName('');
      setShowCategoryForm(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api.adminCreateProduct({
        name: form.name,
        slug: slugify(form.name),
        categoryId: form.categoryId,
        basePriceRs: Number(form.basePriceRs),
        isVeg: form.isVeg,
        prepTimeMinutes: form.prepTimeMinutes ? Number(form.prepTimeMinutes) : undefined,
        nutrition: form.proteinG
          ? {
              proteinG: Number(form.proteinG),
              calories: Number(form.calories || 0),
              carbsG: 0,
              fatG: 0,
              fibreG: 0,
            }
          : undefined,
      });
      // Straight into the full editor so ingredients, allergens, and
      // customisation options can be added right away in one flow,
      // instead of a separate click back into the list first.
      router.push(`/admin/products/${created.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Products</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCategoryForm((v) => !v)}
            className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
          >
            {showCategoryForm ? 'Cancel' : '+ Category'}
          </button>
          <a href="/admin/products/import"
            className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
          >
            📄 Bulk Import
          </a>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
          >
            {showForm ? 'Cancel' : '+ Add Product'}
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {showCategoryForm && (
        <div className="mb-6 flex flex-wrap items-end gap-2 rounded-2xl border border-brand-grey bg-brand-white p-4">
          <div className="flex-1">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-body">Categories</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {categories.map((c) => (
                <span key={c.id} className="flex items-center gap-2 rounded-full bg-brand-bg px-3 py-1 text-xs font-semibold text-brand-black">
                  {c.name}
                  <button
                    onClick={() => deleteCategory(c)}
                    title="Delete category"
                    className="text-red-600 hover:text-red-800"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                placeholder="New category name (e.g. Snacks)"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="flex-1 rounded-lg border border-brand-grey px-3 py-2 text-sm"
              />
              <button
                onClick={submitCategory}
                disabled={saving || !newCategoryName.trim()}
                className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={submitForm} className="mb-8 grid grid-cols-1 gap-3 rounded-2xl border border-brand-grey bg-brand-white p-5 sm:grid-cols-2">
          <input
            required
            placeholder="Product name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
          />
          <select
            required
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          >
            <option value="">Category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            required
            type="number"
            placeholder="Price (₹)"
            value={form.basePriceRs}
            onChange={(e) => setForm({ ...form, basePriceRs: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Protein (g)"
            value={form.proteinG}
            onChange={(e) => setForm({ ...form, proteinG: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Calories"
            value={form.calories}
            onChange={(e) => setForm({ ...form, calories: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Approx. prep/delivery time (minutes)"
            value={form.prepTimeMinutes}
            onChange={(e) => setForm({ ...form, prepTimeMinutes: e.target.value })}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
          />
          <label className="flex items-center gap-2 text-sm text-brand-body sm:col-span-2">
            <input
              type="checkbox"
              checked={form.isVeg}
              onChange={(e) => setForm({ ...form, isVeg: e.target.checked })}
            />
            Vegetarian
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60 sm:col-span-2"
          >
            {saving ? 'Saving…' : 'Save Product'}
          </button>
        </form>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-grey bg-brand-white p-3">
        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-brand-body">
          <input
            type="checkbox"
            checked={products.length > 0 && selectedIds.size === products.length}
            onChange={toggleSelectAll}
          />
          Select all ({products.length})
        </label>
        {selectedIds.size > 0 && (
          <>
            <span className="text-xs text-brand-body">{selectedIds.size} selected</span>
                      <button
              onClick={() => bulkSetActive(false)}
              disabled={bulkDeleting}
              className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
            >
              {bulkDeleting ? 'Working…' : `🔴 Disable Selected (${selectedIds.size})`}
            </button>
            <button
              onClick={() => bulkSetActive(true)}
              disabled={bulkDeleting}
              className="rounded-full border-2 border-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-primary hover:bg-brand-primary hover:text-white disabled:opacity-60"
            >
              {bulkDeleting ? 'Working…' : `🟢 Enable Selected (${selectedIds.size})`}
            </button>
            <button
              onClick={bulkDelete}
              disabled={bulkDeleting}
              className="rounded-full border-2 border-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 hover:bg-red-600 hover:text-white disabled:opacity-60"
            >
              {bulkDeleting ? 'Deleting…' : `🗑️ Delete Selected (${selectedIds.size})`}
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs font-semibold text-brand-body underline">
              Clear selection
            </button>
          </>
        )}
      </div>

      {bulkResult && (
        <div className="mb-4 rounded-2xl border border-brand-grey bg-brand-bg p-4 text-sm">
          <p className="mb-2 font-bold text-brand-black">
            Deleted {bulkResult.deleted} of {bulkResult.deleted + bulkResult.skipped} selected product(s).
          </p>
          {bulkResult.skipped > 0 && (
            <div className="mb-1">
              <p className="mb-1 text-xs font-bold uppercase text-brand-body">Skipped (has existing orders — use Disable instead):</p>
              <ul className="list-disc pl-5 text-brand-body">
                {bulkResult.results
                  .filter((r) => r.status === 'skipped')
                  .map((r) => (
                    <li key={r.id}>{r.name ?? r.id}</li>
                  ))}
              </ul>
            </div>
          )}
          <button onClick={() => setBulkResult(null)} className="mt-1 text-xs font-semibold text-brand-primary underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-col gap-8">
        {categoryNames.map((categoryName) => (
          <div key={categoryName}>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-body">{categoryName}</h2>
            <div className="flex flex-col gap-3">
              {productsByCategory.get(categoryName)!.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-2xl border border-brand-grey bg-brand-white p-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleSelected(p.id)}
                    className="mr-3 h-4 w-4 shrink-0"
                    aria-label={`Select ${p.name}`}
                  />
                  <a href={`/admin/products/${p.id}`} className="flex-1">
                    <p className="font-bold text-brand-black hover:text-brand-primary">{p.name}</p>
                    <p className="text-xs text-brand-body">
                      ₹{p.basePriceRs}
                      {p.nutrition ? ` · ${p.nutrition.proteinG}g protein` : ''}
                    </p>
                  </a>
                  <div className="flex items-center gap-2">
                    <a href={`/admin/products/${p.id}`}
                      className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
                    >
                      Edit
                    </a>
                    <button
                      onClick={() => toggleActive(p)}
                      className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide ${
                        p.isActive ? 'bg-brand-grey/50 text-brand-black' : 'bg-brand-primary text-brand-white'
                      }`}
                    >
                      {p.isActive ? '🔴 Mark Out of Stock' : '🟢 Mark In Stock'}
                    </button>
                    <button
                      onClick={() => deleteProduct(p)}
                      className="rounded-full border-2 border-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 hover:bg-red-600 hover:text-white"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
