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
                <span key={c.id} className="rounded-full bg-brand-bg px-3 py-1 text-xs font-semibold text-brand-black">
                  {c.name}
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

      <div className="flex flex-col gap-3">
        {products.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-2xl border border-brand-grey bg-brand-white p-4">
            <a href={`/admin/products/${p.id}`} className="flex-1">
              <p className="font-bold text-brand-black hover:text-brand-primary">{p.name}</p>
              <p className="text-xs text-brand-body">
                {p.category.name} · ₹{p.basePriceRs}
                {p.nutrition ? ` · ${p.nutrition.proteinG}g protein` : ''}
              </p>
            </a>
            <div className="flex items-center gap-2">
              <a
                href={`/admin/products/${p.id}`}
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
