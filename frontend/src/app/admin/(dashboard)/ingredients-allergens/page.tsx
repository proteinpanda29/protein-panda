'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Ingredient {
  id: string;
  name: string;
  unit: string;
  isActive: boolean;
}

interface Allergen {
  id: string;
  name: string;
  isActive: boolean;
}

export default function IngredientsAllergensPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [allergens, setAllergens] = useState<Allergen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newAllergenName, setNewAllergenName] = useState('');

  const load = () => {
    Promise.all([api.adminIngredients(), api.adminAllergens()])
      .then(([i, a]) => {
        setIngredients(i);
        setAllergens(a);
      })
      .catch((err) => setError(err.message));
  };
  useEffect(load, []);

  const toggleIngredientActive = async (ingredient: Ingredient) => {
    try {
      await api.adminUpdateIngredient(ingredient.id, { isActive: !ingredient.isActive });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteIngredient = async (ingredient: Ingredient) => {
    if (!confirm(`Delete "${ingredient.name}"? This only works if it has no purchase or recipe history.`)) return;
    try {
      await api.adminDeleteIngredient(ingredient.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleAllergenActive = async (allergen: Allergen) => {
    try {
      await api.adminUpdateAllergen(allergen.id, { isActive: !allergen.isActive });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteAllergen = async (allergen: Allergen) => {
    if (!confirm(`Delete "${allergen.name}"? This also removes it from every product/customer it's currently linked to.`)) return;
    try {
      await api.adminDeleteAllergen(allergen.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const addAllergen = async () => {
    if (!newAllergenName.trim()) return;
    try {
      await api.adminCreateAllergen(newAllergenName.trim());
      setNewAllergenName('');
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Ingredients & Allergens</h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-body">
            Ingredients ({ingredients.length})
          </h2>
          <p className="mb-3 text-xs text-brand-body">
            New ingredients are added from a product's Recipe tab. Manage existing ones here.
          </p>
          <div className="flex flex-col gap-2">
            {ingredients.map((ing) => (
              <div key={ing.id} className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white p-3">
                <p className="text-sm font-semibold text-brand-black">
                  {ing.name} <span className="text-xs font-normal text-brand-body">({ing.unit})</span>
                  {!ing.isActive && <span className="ml-2 text-xs font-normal text-brand-body">(disabled)</span>}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleIngredientActive(ing)}
                    className="rounded-full border-2 border-brand-black px-3 py-1 text-[10px] font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary"
                  >
                    {ing.isActive ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => deleteIngredient(ing)}
                    className="rounded-full border-2 border-red-600 px-3 py-1 text-[10px] font-bold uppercase text-red-600 hover:bg-red-600 hover:text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {ingredients.length === 0 && <p className="text-sm text-brand-body">No ingredients yet.</p>}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-body">
            Allergens ({allergens.length})
          </h2>
          <div className="mb-3 flex gap-2">
            <input
              value={newAllergenName}
              onChange={(e) => setNewAllergenName(e.target.value)}
              placeholder="New allergen (e.g. Sesame)"
              className="flex-1 rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
            <button
              onClick={addAllergen}
              disabled={!newAllergenName.trim()}
              className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50"
            >
              Add
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {allergens.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl border border-brand-grey bg-brand-white p-3">
                <p className="text-sm font-semibold text-brand-black">
                  {a.name}
                  {!a.isActive && <span className="ml-2 text-xs font-normal text-brand-body">(disabled)</span>}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleAllergenActive(a)}
                    className="rounded-full border-2 border-brand-black px-3 py-1 text-[10px] font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary"
                  >
                    {a.isActive ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => deleteAllergen(a)}
                    className="rounded-full border-2 border-red-600 px-3 py-1 text-[10px] font-bold uppercase text-red-600 hover:bg-red-600 hover:text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {allergens.length === 0 && <p className="text-sm text-brand-body">No allergens yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
