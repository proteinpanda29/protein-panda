'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Nutrition {
  calories: number;
  proteinG: string;
  carbsG: string;
  fatG: string;
  fibreG: string;
  calciumMg: string | null;
  ironMg: string | null;
  potassiumMg: string | null;
}

interface Addon {
  id: string;
  group: 'BASE' | 'FLAVOUR' | 'LIQUID' | 'ADDON';
  name: string;
  isRequired: boolean;
  extraPriceRs: string;
}

interface Allergen {
  id: string;
  name: string;
}

interface Ingredient {
  id: string;
  name: string;
  unit: string;
}

interface ProductDetail {
  id: string;
  name: string;
  basePriceRs: string;
  isVeg: boolean;
  isActive: boolean;
  isCustomisable: boolean;
  prepTimeMinutes: number | null;
  packagingCostRs: string | null;
  imageUrl: string | null;
  category: { id: string; name: string };
  nutrition: Nutrition | null;
  allergens: { allergen: Allergen }[];
  addonOptions: Addon[];
  ingredients: { ingredient: Ingredient; quantity: string }[];
}

export default function AdminProductEditPage() {
  const params = useParams();
  const productId = params.id as string;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [allAllergens, setAllAllergens] = useState<Allergen[]>([]);
  const [allIngredients, setAllIngredients] = useState<Ingredient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = () => {
    api.adminProductDetail(productId).then(setProduct).catch((err) => setError(err.message));
  };

  useEffect(load, [productId]);
  useEffect(() => {
    api.adminAllergens().then(setAllAllergens).catch(() => undefined);
    api.adminIngredients().then(setAllIngredients).catch(() => undefined);
  }, []);

  if (error) return <p className="text-sm text-brand-body">Couldn&apos;t load this product. ({error})</p>;
  if (!product) return <p className="text-sm text-brand-body">Loading…</p>;

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <a href="/admin/products" className="mb-4 inline-block text-xs font-semibold text-brand-body underline">← Back to Products</a>
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">{product.name}</h1>
      {saved && <p className="mb-4 text-sm text-brand-primary">Saved.</p>}

      <BasicsCard product={product} onSaved={() => { load(); flash(); }} />
      <ImageCard productId={product.id} imageUrl={product.imageUrl} onSaved={() => { load(); flash(); }} />
      <NutritionCard productId={product.id} nutrition={product.nutrition} onSaved={() => { load(); flash(); }} />
      <AllergensCard
        productId={product.id}
        allAllergens={allAllergens}
        selected={product.allergens.map((a) => a.allergen.id)}
        onSaved={() => { load(); flash(); }}
        onAllergenCreated={(a) => setAllAllergens((prev) => [...prev, a])}
      />
      <AddonsCard productId={product.id} addons={product.addonOptions} onChanged={load} />
      <RecipeCard
        productId={product.id}
        recipe={product.ingredients}
        allIngredients={allIngredients}
        onChanged={load}
      />
      <CostingCard productId={product.id} packagingCostRs={product.packagingCostRs} onSaved={() => { load(); flash(); }} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-brand-black">{title}</h2>
      {children}
    </div>
  );
}

function BasicsCard({ product, onSaved }: { product: ProductDetail; onSaved: () => void }) {
  const [name, setName] = useState(product.name);
  const [basePriceRs, setBasePriceRs] = useState(product.basePriceRs);
  const [isVeg, setIsVeg] = useState(product.isVeg);
  const [isActive, setIsActive] = useState(product.isActive);
  const [isCustomisable, setIsCustomisable] = useState(product.isCustomisable);
  const [prepTimeMinutes, setPrepTimeMinutes] = useState(String(product.prepTimeMinutes ?? ''));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.adminUpdateProduct(product.id, {
        name,
        basePriceRs: Number(basePriceRs),
        isVeg,
        isActive,
        isCustomisable,
        prepTimeMinutes: prepTimeMinutes ? Number(prepTimeMinutes) : null,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Basics">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2" />
        <input
          type="number"
          value={basePriceRs}
          onChange={(e) => setBasePriceRs(e.target.value)}
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <label className="text-xs font-semibold text-brand-body">
          Approx. prep/delivery time (minutes)
          <input
            type="number"
            placeholder="e.g. 15"
            value={prepTimeMinutes}
            onChange={(e) => setPrepTimeMinutes(e.target.value)}
            className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
        </label>
        <div className="flex items-center gap-4 text-sm text-brand-body sm:col-span-2">
          <label className="flex items-center gap-1"><input type="checkbox" checked={isVeg} onChange={(e) => setIsVeg(e.target.checked)} /> Veg</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> In Stock (live on menu)</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={isCustomisable} onChange={(e) => setIsCustomisable(e.target.checked)} /> Customisable</label>
        </div>
      </div>
      <button onClick={save} disabled={saving} className="mt-3 rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50">
        {saving ? 'Saving…' : 'Save Basics'}
      </button>
    </Card>
  );
}

const OPTIONAL_NUTRIENTS = [
  { key: 'calciumMg', label: 'Calcium (mg)' },
  { key: 'ironMg', label: 'Iron (mg)' },
  { key: 'potassiumMg', label: 'Potassium (mg)' },
] as const;

function ImageCard({ productId, imageUrl, onSaved }: { productId: string; imageUrl: string | null; onSaved: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      // Get a fresh, admin-only signature for this specific upload —
      // the actual file bytes go straight to Cloudinary from here, not
      // through this app's own backend at all.
      const sig = await api.adminGetUploadSignature();

      const formData = new FormData();
      formData.append('file', file);
      formData.append('api_key', sig.apiKey);
      formData.append('timestamp', String(sig.timestamp));
      formData.append('signature', sig.signature);
      formData.append('folder', sig.folder);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? 'Upload failed');
      }
      const { secure_url } = await res.json();

      await api.adminUpdateProduct(productId, { imageUrl: secure_url });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card title="Product Photo">
      <div className="flex items-center gap-4">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Product" className="h-24 w-24 rounded-xl border border-brand-grey object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-xl border-2 border-dashed border-brand-grey text-xs text-brand-body">
            No photo
          </div>
        )}
        <div>
          <label className="cursor-pointer rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent">
            {uploading ? 'Uploading…' : imageUrl ? 'Replace Photo' : 'Upload Photo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
          </label>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </Card>
  );
}

function NutritionCard({ productId, nutrition, onSaved }: { productId: string; nutrition: Nutrition | null; onSaved: () => void }) {
  const [calories, setCalories] = useState(String(nutrition?.calories ?? ''));
  const [proteinG, setProteinG] = useState(nutrition?.proteinG ?? '');
  const [carbsG, setCarbsG] = useState(nutrition?.carbsG ?? '');
  const [fatG, setFatG] = useState(nutrition?.fatG ?? '');
  const [fibreG, setFibreG] = useState(nutrition?.fibreG ?? '');
  // Extended/optional nutrients (Calcium, Iron, Potassium) — previously
  // in the database schema but never actually shown anywhere in the
  // admin UI, so there was no way to enter them even though the app
  // could store them. Picked via a dropdown ("which nutrient") rather
  // than always-visible fields, since most products won't need all of
  // these — only whichever ones actually apply.
  const [optionalValues, setOptionalValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    OPTIONAL_NUTRIENTS.forEach(({ key }) => {
      const v = nutrition?.[key as keyof Nutrition];
      if (v !== null && v !== undefined) initial[key] = String(v);
    });
    return initial;
  });
  const [nutrientToAdd, setNutrientToAdd] = useState('');
  const [saving, setSaving] = useState(false);

  const addableNutrients = OPTIONAL_NUTRIENTS.filter(({ key }) => !(key in optionalValues));

  const addNutrient = () => {
    if (!nutrientToAdd) return;
    setOptionalValues((prev) => ({ ...prev, [nutrientToAdd]: '' }));
    setNutrientToAdd('');
  };

  const removeNutrient = (key: string) => {
    setOptionalValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.adminUpdateProduct(productId, {
        nutrition: {
          calories: Number(calories || 0),
          proteinG: Number(proteinG || 0),
          carbsG: Number(carbsG || 0),
          fatG: Number(fatG || 0),
          fibreG: Number(fibreG || 0),
          calciumMg: optionalValues.calciumMg !== undefined ? Number(optionalValues.calciumMg || 0) : null,
          ironMg: optionalValues.ironMg !== undefined ? Number(optionalValues.ironMg || 0) : null,
          potassiumMg: optionalValues.potassiumMg !== undefined ? Number(optionalValues.potassiumMg || 0) : null,
        },
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Nutrition (per unit)">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <NumField label="Calories" value={calories} onChange={setCalories} />
        <NumField label="Protein (g)" value={proteinG} onChange={setProteinG} />
        <NumField label="Carbs (g)" value={carbsG} onChange={setCarbsG} />
        <NumField label="Fat (g)" value={fatG} onChange={setFatG} />
        <NumField label="Fibre (g)" value={fibreG} onChange={setFibreG} />
      </div>

      {Object.keys(optionalValues).length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {OPTIONAL_NUTRIENTS.filter(({ key }) => key in optionalValues).map(({ key, label }) => (
            <div key={key} className="relative">
              <NumField
                label={label}
                value={optionalValues[key]}
                onChange={(v) => setOptionalValues((prev) => ({ ...prev, [key]: v }))}
              />
              <button
                onClick={() => removeNutrient(key)}
                className="absolute right-1 top-0 text-xs text-brand-body hover:text-red-600"
                title={`Remove ${label}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {addableNutrients.length > 0 && (
        <div className="mt-4 flex items-center gap-2 border-t border-brand-grey pt-4">
          <select
            value={nutrientToAdd}
            onChange={(e) => setNutrientToAdd(e.target.value)}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          >
            <option value="">+ Add a nutrient…</option>
            {addableNutrients.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            onClick={addNutrient}
            disabled={!nutrientToAdd}
            className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      <button onClick={save} disabled={saving} className="mt-4 rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50">
        {saving ? 'Saving…' : 'Save Nutrition'}
      </button>
    </Card>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs font-semibold text-brand-body">
      {label}
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-brand-grey px-2 py-2 text-sm" />
    </label>
  );
}

function AllergensCard({
  productId,
  allAllergens,
  selected,
  onSaved,
  onAllergenCreated,
}: {
  productId: string;
  allAllergens: Allergen[];
  selected: string[];
  onSaved: () => void;
  onAllergenCreated: (a: Allergen) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set(selected));
  const [newAllergen, setNewAllergen] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => setChosen(new Set(selected)), [selected]);

  const toggle = (id: string) => {
    setChosen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.adminSetProductAllergens(productId, [...chosen]);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const addAllergen = async () => {
    if (!newAllergen.trim()) return;
    const created = await api.adminCreateAllergen(newAllergen.trim());
    onAllergenCreated(created);
    setNewAllergen('');
  };

  return (
    <Card title="Allergens">
      <div className="mb-3 flex flex-wrap gap-2">
        {allAllergens.map((a) => (
          <button
            key={a.id}
            onClick={() => toggle(a.id)}
            className={`rounded-full border-2 px-3 py-1 text-xs font-semibold ${
              chosen.has(a.id) ? 'border-red-500 bg-red-500 text-white' : 'border-brand-grey text-brand-black'
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>
      <div className="mb-3 flex gap-2">
        <input
          placeholder="New allergen (e.g. Gluten)"
          value={newAllergen}
          onChange={(e) => setNewAllergen(e.target.value)}
          className="flex-1 rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <button onClick={addAllergen} className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black">
          + New
        </button>
      </div>
      <button onClick={save} disabled={saving} className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50">
        {saving ? 'Saving…' : 'Save Allergens'}
      </button>
    </Card>
  );
}

const GROUPS = ['BASE', 'FLAVOUR', 'LIQUID', 'ADDON'] as const;

function AddonsCard({ productId, addons, onChanged }: { productId: string; addons: Addon[]; onChanged: () => void }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('ADDON');
  const [name, setName] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [extraPriceRs, setExtraPriceRs] = useState('0');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.adminCreateAddon(productId, { group, name, isRequired, extraPriceRs: Number(extraPriceRs) });
      setName('');
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (addonId: string) => {
    await api.adminDeleteAddon(addonId);
    onChanged();
  };

  return (
    <Card title="Customisation Options (Base / Flavour / Liquid / Add-ons)">
      {GROUPS.map((g) => {
        const items = addons.filter((a) => a.group === g);
        if (items.length === 0) return null;
        return (
          <div key={g} className="mb-3">
            <p className="mb-1 text-xs font-bold uppercase text-brand-body">{g}</p>
            <div className="flex flex-wrap gap-2">
              {items.map((a) => (
                <span key={a.id} className="flex items-center gap-1 rounded-full bg-brand-bg px-3 py-1 text-xs">
                  {a.name} {Number(a.extraPriceRs) > 0 && `+₹${a.extraPriceRs}`} {a.isRequired && '· required'}
                  <button onClick={() => remove(a.id)} className="ml-1 text-red-600">✕</button>
                </span>
              ))}
            </div>
          </div>
        );
      })}

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-brand-grey pt-4">
        <select value={group} onChange={(e) => setGroup(e.target.value as any)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm">
          {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <input placeholder="Option name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
        <input type="number" placeholder="Extra ₹" value={extraPriceRs} onChange={(e) => setExtraPriceRs(e.target.value)} className="w-24 rounded-lg border border-brand-grey px-3 py-2 text-sm" />
        <label className="flex items-center gap-1 text-xs text-brand-body">
          <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} /> Required
        </label>
        <button onClick={add} disabled={saving || !name.trim()} className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50">
          + Add Option
        </button>
      </div>
    </Card>
  );
}

const PRESET_QUANTITIES = [5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 200, 250, 500, 1000];

function RecipeCard({
  productId,
  recipe,
  allIngredients,
  onChanged,
}: {
  productId: string;
  recipe: { ingredient: Ingredient; quantity: string }[];
  allIngredients: Ingredient[];
  onChanged: () => void;
}) {
  const [ingredientId, setIngredientId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [useCustomQuantity, setUseCustomQuantity] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedUnit = allIngredients.find((i) => i.id === ingredientId)?.unit;

  const add = async () => {
    if (!ingredientId || !quantity) return;
    setSaving(true);
    try {
      await api.adminSetProductIngredient(productId, ingredientId, Number(quantity));
      setIngredientId('');
      setQuantity('');
      setUseCustomQuantity(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (ingId: string) => {
    await api.adminRemoveProductIngredient(productId, ingId);
    onChanged();
  };

  return (
    <Card title="Recipe (powers inventory deduction on sale)">
      <div className="mb-3 flex flex-col gap-2">
        {recipe.length === 0 && <p className="text-sm text-brand-body">No ingredients linked yet — stock won&apos;t deduct for this product until you add some.</p>}
        {recipe.map((r) => (
          <div key={r.ingredient.id} className="flex items-center justify-between rounded-lg bg-brand-bg px-3 py-2 text-sm">
            <span>{r.ingredient.name} — {r.quantity} {r.ingredient.unit} per unit</span>
            <button onClick={() => remove(r.ingredient.id)} className="text-xs text-red-600">Remove</button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-brand-grey pt-4">
        <select
          value={ingredientId}
          onChange={(e) => {
            setIngredientId(e.target.value);
            setQuantity('');
            setUseCustomQuantity(false);
          }}
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        >
          <option value="">Ingredient…</option>
          {allIngredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
        </select>

        {/* Quantity is a preset dropdown of common amounts, with a
            "Custom…" escape hatch for anything unusual — the unit
            itself isn't separately selectable here on purpose: it's
            inherent to whichever ingredient was chosen above (an
            ingredient's inventory is always tracked in one fixed unit,
            so a per-recipe-line unit override would silently
            contradict that). */}
        {!useCustomQuantity ? (
          <select
            value={quantity}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                setUseCustomQuantity(true);
                setQuantity('');
              } else {
                setQuantity(e.target.value);
              }
            }}
            disabled={!ingredientId}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="">Quantity{selectedUnit ? ` (${selectedUnit})` : ''}…</option>
            {PRESET_QUANTITIES.map((q) => (
              <option key={q} value={q}>
                {q} {selectedUnit}
              </option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
        ) : (
          <input
            type="number"
            placeholder={`Quantity${selectedUnit ? ` (${selectedUnit})` : ''}`}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
        )}

        <button onClick={add} disabled={saving || !ingredientId || !quantity} className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50">
          + Link Ingredient
        </button>
      </div>
    </Card>
  );
}

interface CostingData {
  priceRs: number;
  ingredientCosts: { ingredientName: string; quantity: number; unit: string; costPerUnitRs: number | null; lineCostRs: number; costKnown: boolean }[];
  foodCostRs: number;
  packagingCostRs: number;
  totalCostRs: number;
  grossMarginRs: number;
  grossMarginPct: number;
  hasUnknownCosts: boolean;
  hasNoRecipe: boolean;
}

function CostingCard({ productId, packagingCostRs, onSaved }: { productId: string; packagingCostRs: string | null; onSaved: () => void }) {
  const [costing, setCosting] = useState<CostingData | null>(null);
  const [packaging, setPackaging] = useState(packagingCostRs ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.adminProductCosting(productId).then(setCosting).catch(() => undefined);
  };

  useEffect(load, [productId]);

  const savePackaging = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminUpdateProduct(productId, { packagingCostRs: packaging ? Number(packaging) : null });
      onSaved();
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Costing & Margin">
      {costing?.hasNoRecipe && (
        <p className="mb-3 text-xs text-brand-body">No recipe linked yet — add ingredients above to see real food cost.</p>
      )}
      {costing?.hasUnknownCosts && !costing?.hasNoRecipe && (
        <p className="mb-3 text-xs text-yellow-700">
          ⚠️ Some ingredients have no purchase price on record yet (record a Purchase on the Suppliers page) — their cost is counted as ₹0 for now, so this margin is optimistic.
        </p>
      )}

      {costing && costing.ingredientCosts.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {costing.ingredientCosts.map((i) => (
            <li key={i.ingredientName} className="flex justify-between">
              <span className="text-brand-body">
                {i.quantity}{i.unit} {i.ingredientName} {!i.costKnown && <span className="text-yellow-700">(no cost data)</span>}
              </span>
              <span className="text-brand-black">₹{i.lineCostRs.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}

      <label className="mb-3 block text-xs font-semibold text-brand-body">
        Packaging/other cost (₹, optional — cup, lid, straw, etc.)
        <input
          type="number"
          value={packaging}
          onChange={(e) => setPackaging(e.target.value)}
          className="mt-1 w-40 rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
      </label>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button onClick={savePackaging} disabled={saving} className="mb-4 rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50">
        {saving ? 'Saving…' : 'Save Packaging Cost'}
      </button>

      {costing && (
        <div className="rounded-xl bg-brand-bg p-3 text-sm">
          <div className="flex justify-between"><span className="text-brand-body">Selling price</span><span>₹{costing.priceRs.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-brand-body">Food cost</span><span>₹{costing.foodCostRs.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-brand-body">Packaging</span><span>₹{costing.packagingCostRs.toFixed(2)}</span></div>
          <div className="mt-1 flex justify-between border-t border-brand-grey pt-1 font-bold">
            <span>Gross margin</span>
            <span className={costing.grossMarginPct < 0 ? 'text-red-600' : costing.grossMarginPct < 20 ? 'text-yellow-700' : 'text-brand-primary'}>
              ₹{costing.grossMarginRs.toFixed(2)} ({costing.grossMarginPct.toFixed(0)}%)
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
