'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Nutrition {
  servingSizeG: string | null;
  calories: number;
  proteinG: string;
  carbsG: string;
  fatG: string;
  fibreG: string;
  calciumMg: string | null;
  ironMg: string | null;
  potassiumMg: string | null;
}

interface Product {
  id: string;
  name: string;
  imageUrl: string | null;
  category: { name: string };
  nutrition: Nutrition | null;
}

export default function NutritionGuidePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api
      .listProducts()
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const withNutrition = products.filter(
    (p) => p.nutrition && p.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Full Nutrition Guide</h1>
      <p className="mb-6 text-sm text-brand-body">
        Every item on the menu — photo, approximate serving size, and the complete macro and micro breakdown.
      </p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search an item…"
        className="mb-6 w-full max-w-sm rounded-full border border-brand-grey px-4 py-2 text-sm"
      />

      {loading && <p className="text-sm text-brand-body">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && withNutrition.length === 0 && !error && (
        <p className="text-sm text-brand-body">Nothing matches — try a different search, or check back soon.</p>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {withNutrition.map((p) => {
          const n = p.nutrition!;
          return (
            <div key={p.id} className="flex gap-4 rounded-2xl border border-brand-grey bg-brand-white p-4">
              <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl bg-brand-bg">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl">🍽️</div>
                )}
              </div>

              <div className="flex-1">
                <p className="text-sm font-bold text-brand-black">{p.name}</p>
                <p className="mb-2 text-[11px] text-brand-body">
                  {p.category?.name}
                  {n.servingSizeG && ` · Approx. ${n.servingSizeG}g serving`}
                </p>

                <div className="mb-2 grid grid-cols-4 gap-1 text-center">
                  <div className="rounded-lg bg-brand-bg py-1">
                    <p className="text-[9px] font-bold uppercase text-brand-body">Cal</p>
                    <p className="text-xs font-bold text-brand-black">{n.calories}</p>
                  </div>
                  <div className="rounded-lg bg-brand-bg py-1">
                    <p className="text-[9px] font-bold uppercase text-brand-body">Protein</p>
                    <p className="text-xs font-bold text-brand-black">{n.proteinG}g</p>
                  </div>
                  <div className="rounded-lg bg-brand-bg py-1">
                    <p className="text-[9px] font-bold uppercase text-brand-body">Carbs</p>
                    <p className="text-xs font-bold text-brand-black">{n.carbsG}g</p>
                  </div>
                  <div className="rounded-lg bg-brand-bg py-1">
                    <p className="text-[9px] font-bold uppercase text-brand-body">Fat</p>
                    <p className="text-xs font-bold text-brand-black">{n.fatG}g</p>
                  </div>
                </div>

                <p className="text-[10px] text-brand-body">
                  Fibre {n.fibreG}g
                  {n.calciumMg && ` · Calcium ${n.calciumMg}mg`}
                  {n.ironMg && ` · Iron ${n.ironMg}mg`}
                  {n.potassiumMg && ` · Potassium ${n.potassiumMg}mg`}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
