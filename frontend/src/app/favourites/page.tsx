'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { api } from '@/lib/api';
import { useCart } from '@/lib/cart-context';

interface FavouriteProduct {
  id: string;
  name: string;
  basePriceRs: string;
  isVeg: boolean;
  isCustomisable: boolean;
  imageUrl: string | null;
  nutrition?: { proteinG: string; calories: number } | null;
}

export default function FavouritesPage() {
  const [products, setProducts] = useState<FavouriteProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addItem } = useCart();

  useEffect(() => {
    api
      .myFavourites()
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const remove = async (productId: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    await api.removeFavourite(productId).catch(() => undefined);
  };

  const quickAdd = (p: FavouriteProduct) => {
    addItem({ productId: p.id, name: p.name, basePriceRs: Number(p.basePriceRs), addons: [], proteinG: Number(p.nutrition?.proteinG ?? 0), calories: p.nutrition?.calories ?? 0 });
  };

  if (error) {
    return (
      <section className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-4 text-sm text-brand-body">Please log in to see your favourites.</p>
        <a href="/login?redirect=/favourites" className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent">
          Go to Login
        </a>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">❤️ Your Favourites</h1>

      {loading && <p className="text-sm text-brand-body">Loading…</p>}
      {!loading && products.length === 0 && (
        <p className="text-sm text-brand-body">
          Nothing saved yet — tap the heart on any product in the{' '}
          <a href="/menu" className="font-bold text-brand-primary underline">
            menu
          </a>{' '}
          to save it here.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <div key={p.id} className="rounded-2xl border border-brand-grey bg-brand-white p-5">
            {p.imageUrl && (
              <div className="relative mb-3 h-40 w-full overflow-hidden rounded-xl bg-brand-bg">
                <Image src={p.imageUrl} alt={p.name} fill className="object-cover" sizes="(max-width: 640px) 100vw, 33vw" />
              </div>
            )}
            <div className="mb-2 flex items-start justify-between">
              <h3 className="text-lg font-bold text-brand-black">{p.name}</h3>
              <button onClick={() => remove(p.id)} title="Remove from favourites" className="text-lg">
                ❤️
              </button>
            </div>
            {p.nutrition && (
              <p className="mb-3 text-xs text-brand-body">
                {p.nutrition.proteinG}g protein · {p.nutrition.calories} kcal
              </p>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-brand-black">₹{p.basePriceRs}</span>
              <button
                onClick={() => quickAdd(p)}
                className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
              >
                + Add
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
