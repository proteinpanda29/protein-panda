'use client';

import { useMemo, useState } from 'react';
import { useCart } from '@/lib/cart-context';

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
  addonOptions: Addon[];
  nutrition?: { proteinG: string; calories: number } | null;
}

const GROUP_LABELS: Record<string, string> = {
  BASE: 'Choose your Base',
  FLAVOUR: 'Choose a Flavour',
  LIQUID: 'Choose your Liquid',
  ADDON: 'Add-ons (optional)',
};

export function CustomizeModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { addItem } = useCart();

  const grouped = useMemo(() => {
    const groups: Record<string, Addon[]> = { BASE: [], FLAVOUR: [], LIQUID: [], ADDON: [] };
    product.addonOptions.forEach((a) => groups[a.group]?.push(a));
    return groups;
  }, [product]);

  const [selected, setSelected] = useState<Record<string, string>>(() => {
    // default to the first option in each required group
    const initial: Record<string, string> = {};
    (['BASE', 'FLAVOUR', 'LIQUID'] as const).forEach((g) => {
      if (grouped[g][0]) initial[g] = grouped[g][0].id;
    });
    return initial;
  });
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);
  const [specialInstructions, setSpecialInstructions] = useState('');

  const chosenAddons: Addon[] = [
    ...Object.values(selected)
      .map((id) => product.addonOptions.find((a) => a.id === id))
      .filter((a): a is Addon => !!a),
    ...product.addonOptions.filter((a) => addonIds.has(a.id)),
  ];

  const basePrice = Number(product.basePriceRs);
  const addonsPrice = chosenAddons.reduce((s, a) => s + Number(a.extraPriceRs), 0);
  const unitPrice = basePrice + addonsPrice;
  const proteinG = Number(product.nutrition?.proteinG ?? 0) + chosenAddons.reduce((s, a) => s + Number(a.extraProteinG ?? 0), 0);
  const calories = (product.nutrition?.calories ?? 0) + chosenAddons.reduce((s, a) => s + (a.extraCalories ?? 0), 0);

  const missingRequired = (['BASE', 'FLAVOUR', 'LIQUID'] as const).filter((g) => grouped[g].length > 0 && !selected[g]);

  const handleAddToCart = () => {
    addItem(
      {
        productId: product.id,
        name: product.name,
        basePriceRs: basePrice,
        addons: chosenAddons.map((a) => ({ id: a.id, name: a.name, group: a.group, extraPriceRs: Number(a.extraPriceRs) })),
        proteinG,
        calories,
        specialInstructions: specialInstructions.trim() || undefined,
      },
      quantity,
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-brand-white p-6 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-extrabold text-brand-black">{product.name}</h2>
          <button onClick={onClose} className="text-brand-body" aria-label="Close">✕</button>
        </div>

        {(['BASE', 'FLAVOUR', 'LIQUID'] as const).map(
          (group) =>
            grouped[group].length > 0 && (
              <div key={group} className="mb-5">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-body">{GROUP_LABELS[group]}</p>
                <div className="flex flex-wrap gap-2">
                  {grouped[group].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelected((s) => ({ ...s, [group]: opt.id }))}
                      className={`rounded-full border-2 px-4 py-2 text-sm font-semibold ${
                        selected[group] === opt.id
                          ? 'border-brand-primary bg-brand-primary text-brand-white'
                          : 'border-brand-grey text-brand-black hover:border-brand-primary'
                      }`}
                    >
                      {opt.name}
                      {Number(opt.extraPriceRs) > 0 ? ` +₹${opt.extraPriceRs}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            ),
        )}

        {grouped.ADDON.length > 0 && (
          <div className="mb-5">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-body">{GROUP_LABELS.ADDON}</p>
            <div className="flex flex-wrap gap-2">
              {grouped.ADDON.map((opt) => {
                const active = addonIds.has(opt.id);
                return (
                  <button
                    key={opt.id}
                    onClick={() =>
                      setAddonIds((prev) => {
                        const next = new Set(prev);
                        active ? next.delete(opt.id) : next.add(opt.id);
                        return next;
                      })
                    }
                    className={`rounded-full border-2 px-4 py-2 text-sm font-semibold ${
                      active ? 'border-brand-accent bg-brand-accent text-brand-black' : 'border-brand-grey text-brand-black hover:border-brand-accent'
                    }`}
                  >
                    {opt.name} +₹{opt.extraPriceRs}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-5 rounded-xl bg-brand-bg p-4 text-sm">
          <p className="font-bold text-brand-black">
            {proteinG.toFixed(0)}g protein · {calories.toFixed(0)} kcal
          </p>
          <p className="text-brand-body">₹{unitPrice.toFixed(0)} per item</p>
        </div>

        <input
          value={specialInstructions}
          onChange={(e) => setSpecialInstructions(e.target.value)}
          placeholder="Special instructions (optional) — e.g. no ice, extra hot"
          maxLength={200}
          className="mb-4 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm outline-none focus:border-brand-primary"
        />

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 rounded-full border border-brand-grey px-3 py-1">
            <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="px-2 text-lg font-bold text-brand-black">−</button>
            <span className="w-6 text-center font-bold text-brand-black">{quantity}</span>
            <button onClick={() => setQuantity((q) => q + 1)} className="px-2 text-lg font-bold text-brand-black">+</button>
          </div>
          <button
            onClick={handleAddToCart}
            disabled={missingRequired.length > 0}
            className="flex-1 rounded-full bg-brand-primary py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-50"
          >
            Add to Cart · ₹{(unitPrice * quantity).toFixed(0)}
          </button>
        </div>
      </div>
    </div>
  );
}
