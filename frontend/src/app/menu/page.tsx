'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { api } from '@/lib/api';
import { useCart } from '@/lib/cart-context';
import { CustomizeModal } from '@/components/CustomizeModal';

interface Addon {
  id: string;
  group: 'BASE' | 'FLAVOUR' | 'LIQUID' | 'ADDON';
  name: string;
  isRequired: boolean;
  extraPriceRs: string;
  extraProteinG: string | null;
  extraCalories: number | null;
}

interface Product {
  id: string;
  name: string;
  basePriceRs: string;
  isVeg: boolean;
  isCustomisable: boolean;
  prepTimeMinutes?: number | null;
  imageUrl?: string | null;
  nutrition?: { proteinG: string; calories: number } | null;
  category?: { name: string } | null;
  addonOptions: Addon[];
  allergens?: { allergen: { name: string } }[];
}

export default function MenuPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(new Set());
  const { addItem, totalCount, totalRs } = useCart();

  useEffect(() => {
    api
      .listProducts()
      .then(setProducts)
      .catch((err) => setError(err.message));

    // Guest browsing is intentionally allowed on this page — a failed
    // favourites fetch (not logged in) just means every heart starts
    // unfilled, not an error shown to the customer.
    api
      .myFavouriteIds()
      .then((ids: string[]) => setFavouriteIds(new Set(ids)))
      .catch(() => undefined);
  }, []);

  const toggleFavourite = async (productId: string) => {
    const wasFavourited = favouriteIds.has(productId);
    // Optimistic update — a heart toggle should feel instant, not wait
    // on a round trip. Reverted below if the request actually fails
    // (most commonly: not logged in yet).
    setFavouriteIds((prev) => {
      const next = new Set(prev);
      if (wasFavourited) next.delete(productId);
      else next.add(productId);
      return next;
    });

    try {
      if (wasFavourited) await api.removeFavourite(productId);
      else await api.addFavourite(productId);
    } catch {
      setFavouriteIds((prev) => {
        const next = new Set(prev);
        if (wasFavourited) next.add(productId);
        else next.delete(productId);
        return next;
      });
      if (typeof window !== 'undefined') window.location.href = '/login?redirect=/menu';
    }
  };

  const quickAdd = (p: Product) => {
    addItem({
      productId: p.id,
      name: p.name,
      basePriceRs: Number(p.basePriceRs),
      addons: [],
      proteinG: Number(p.nutrition?.proteinG ?? 0),
      calories: p.nutrition?.calories ?? 0,
    });
  };

  return (
    <section className="mx-auto max-w-6xl px-4 py-12 pb-28">
      <h1 className="mb-8 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Order Now</h1>

      {error && <p className="text-sm text-brand-body">Couldn&apos;t load the menu right now — try again shortly.</p>}
      {!error && products.length === 0 && (
        <p className="text-sm text-brand-body">No products yet — add some from the admin dashboard.</p>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <div key={p.id} className="rounded-2xl border border-brand-grey bg-brand-white p-5">
            {p.imageUrl && (
              <div className="relative mb-3 h-40 w-full overflow-hidden rounded-xl bg-brand-bg">
                <Image src={p.imageUrl} alt={p.name} fill className="object-cover" sizes="(max-width: 640px) 100vw, 33vw" />
                <button
                  onClick={() => toggleFavourite(p.id)}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-brand-white/90 text-lg shadow-sm"
                  title={favouriteIds.has(p.id) ? 'Remove from favourites' : 'Add to favourites'}
                >
                  {favouriteIds.has(p.id) ? '❤️' : '🤍'}
                </button>
              </div>
            )}
            <div className="mb-2 flex items-start justify-between">
              <h3 className="text-lg font-bold text-brand-black">{p.name}</h3>
              <div className="flex items-center gap-2">
                {!p.imageUrl && (
                  <button
                    onClick={() => toggleFavourite(p.id)}
                    className="text-lg"
                    title={favouriteIds.has(p.id) ? 'Remove from favourites' : 'Add to favourites'}
                  >
                    {favouriteIds.has(p.id) ? '❤️' : '🤍'}
                  </button>
                )}
                <span className={`h-3 w-3 shrink-0 rounded-full border-2 ${p.isVeg ? 'border-green-600' : 'border-red-600'}`} />
              </div>
            </div>
            {p.nutrition && (
              <p className="mb-1 text-xs text-brand-body">
                {p.nutrition.proteinG}g protein · {p.nutrition.calories} kcal
              </p>
            )}
            {p.prepTimeMinutes && (
              <p className="mb-1 text-xs text-brand-body">⏱ Ready in ~{p.prepTimeMinutes} min</p>
            )}
            {p.allergens && p.allergens.length > 0 && (
              <p className="mb-3 flex flex-wrap gap-1">
                {p.allergens.map((a) => (
                  <span key={a.allergen.name} className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                    ⚠ {a.allergen.name}
                  </span>
                ))}
              </p>
            )}
            <div className="flex items-center justify-between">
              <span className="font-bold text-brand-black">₹{p.basePriceRs}</span>
              {p.isCustomisable ? (
                <button
                  onClick={() => setCustomizing(p)}
                  className="rounded-full border-2 border-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-primary hover:bg-brand-primary hover:text-brand-white"
                >
                  Customise
                </button>
              ) : (
                <button
                  onClick={() => quickAdd(p)}
                  className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
                >
                  Add
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {customizing && <CustomizeModal product={customizing} onClose={() => setCustomizing(null)} />}

      {totalCount > 0 && (
        <a
          href="/checkout"
          className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between rounded-full bg-brand-black px-6 py-4 text-brand-white shadow-lg sm:inset-x-auto sm:right-6 sm:w-96"
        >
          <span className="text-sm font-bold uppercase tracking-wide">{totalCount} item{totalCount > 1 ? 's' : ''}</span>
          <span className="text-sm font-bold">₹{totalRs.toFixed(0)} · View Cart →</span>
        </a>
      )}
    </section>
  );
}
