'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface CartAddon {
  id: string;
  name: string;
  group: string;
  extraPriceRs: number;
}

export interface CartItem {
  key: string; // unique per distinct customisation, so the same product with
  // different add-ons shows as separate lines
  productId: string;
  name: string;
  quantity: number;
  basePriceRs: number;
  addons: CartAddon[];
  proteinG: number;
  calories: number;
  specialInstructions?: string;
}

interface CartContextValue {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'key' | 'quantity'>, quantity?: number) => void;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  totalRs: number;
  totalCount: number;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = 'pp_cart';

const lineTotal = (item: CartItem) =>
  (item.basePriceRs + item.addons.reduce((s, a) => s + a.extraPriceRs, 0)) * item.quantity;

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      // ignore corrupt cart data
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const addItem: CartContextValue['addItem'] = (item, quantity = 1) => {
    const addonKey = item.addons.map((a) => a.id).sort().join(',');
    // specialInstructions is part of the key too — two of the same item
    // with different notes ("extra hot" vs none) are genuinely
    // different orders from the kitchen's perspective and must stay as
    // separate lines, not silently merge into one with only the first
    // note surviving.
    const key = `${item.productId}::${addonKey}::${item.specialInstructions ?? ''}`;
    setItems((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) => (i.key === key ? { ...i, quantity: i.quantity + quantity } : i));
      }
      return [...prev, { ...item, key, quantity }];
    });
  };

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const updateQuantity = (key: string, quantity: number) => {
    if (quantity <= 0) return removeItem(key);
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, quantity } : i)));
  };

  const clear = () => setItems([]);

  const totalRs = items.reduce((sum, i) => sum + lineTotal(i), 0);
  const totalCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clear, totalRs, totalCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
