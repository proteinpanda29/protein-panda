'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface SupplementProduct {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  labCertificateUrl: string | null;
  labTestedDate: string | null;
  isActive: boolean;
}

interface SupplementBrand {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  supplements: SupplementProduct[];
}

/** Uploads one file straight to Cloudinary using a freshly-fetched, admin-only signature — the same pattern already used for product photos. */
async function uploadToCloudinary(file: File): Promise<string> {
  const sig = await api.adminSupplementUploadSignature();
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
  return secure_url;
}

export default function AdminSupplementsPage() {
  const [brands, setBrands] = useState<SupplementBrand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showBrandForm, setShowBrandForm] = useState(false);
  const [addingProductToBrandId, setAddingProductToBrandId] = useState<string | null>(null);

  const load = () => {
    api.adminListSupplements().then(setBrands).catch((err) => setError(err.message));
  };
  useEffect(load, []);

  const toggleBrandActive = async (brand: SupplementBrand) => {
    await api.adminUpdateSupplementBrand(brand.id, { isActive: !brand.isActive });
    load();
  };

  const deleteBrand = async (id: string) => {
    if (!confirm('Delete this brand and all its products? This cannot be undone.')) return;
    await api.adminDeleteSupplementBrand(id);
    load();
  };

  const toggleProductActive = async (product: SupplementProduct) => {
    await api.adminUpdateSupplementProduct(product.id, { isActive: !product.isActive });
    load();
  };

  const deleteProduct = async (id: string) => {
    if (!confirm('Delete this product?')) return;
    await api.adminDeleteSupplementProduct(id);
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Supplements</h1>
        <button
          onClick={() => setShowBrandForm((v) => !v)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          {showBrandForm ? 'Cancel' : '+ Add Brand'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {showBrandForm && (
        <BrandForm
          onSaved={() => {
            setShowBrandForm(false);
            load();
          }}
        />
      )}

      {brands.length === 0 && !showBrandForm && (
        <p className="text-sm text-brand-body">No brands added yet — click "+ Add Brand" to get started.</p>
      )}

      <div className="flex flex-col gap-4">
        {brands.map((brand) => (
          <div key={brand.id} className="rounded-2xl border border-brand-grey bg-brand-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {brand.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logoUrl} alt={brand.name} className="h-12 w-12 rounded-lg object-contain" />
                )}
                <div>
                  <p className="font-bold text-brand-black">
                    {brand.name} {!brand.isActive && <span className="text-xs font-normal text-brand-body">(disabled)</span>}
                  </p>
                  <p className="text-xs text-brand-body">{brand.supplements.length} product{brand.supplements.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setAddingProductToBrandId(addingProductToBrandId === brand.id ? null : brand.id)}
                  className="rounded-full border-2 border-brand-primary px-3 py-1.5 text-xs font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-brand-white"
                >
                  + Product
                </button>
                <button
                  onClick={() => toggleBrandActive(brand)}
                  className="rounded-full border-2 border-brand-black px-3 py-1.5 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary"
                >
                  {brand.isActive ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => deleteBrand(brand.id)}
                  className="rounded-full border-2 border-red-600 px-3 py-1.5 text-xs font-bold uppercase text-red-600 hover:bg-red-600 hover:text-white"
                >
                  Delete
                </button>
              </div>
            </div>

            {addingProductToBrandId === brand.id && (
              <ProductForm
                brandId={brand.id}
                onSaved={() => {
                  setAddingProductToBrandId(null);
                  load();
                }}
              />
            )}

            {brand.supplements.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {brand.supplements.map((product) => (
                  <div key={product.id} className="flex items-center gap-3 rounded-xl bg-brand-bg p-3">
                    {product.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt={product.name} className="h-12 w-12 rounded-lg object-cover" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-bold text-brand-black">
                        {product.name} {!product.isActive && <span className="text-xs font-normal text-brand-body">(disabled)</span>}
                      </p>
                      {product.labCertificateUrl && <p className="text-xs text-brand-primary">🧪 Lab certificate uploaded</p>}
                    </div>
                    <button
                      onClick={() => toggleProductActive(product)}
                      className="rounded-full border-2 border-brand-black px-3 py-1 text-[10px] font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary"
                    >
                      {product.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => deleteProduct(product.id)}
                      className="rounded-full border-2 border-red-600 px-3 py-1 text-[10px] font-bold uppercase text-red-600 hover:bg-red-600 hover:text-white"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogoFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      setLogoUrl(await uploadToCloudinary(file));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!name.trim()) {
      setError('Brand name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateSupplementBrand({ name, description: description || undefined, websiteUrl: websiteUrl || undefined, logoUrl: logoUrl || undefined });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">New Brand</h2>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Brand name (e.g. Optimum Nutrition)"
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Why we chose this brand (optional)"
        rows={2}
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <input
        value={websiteUrl}
        onChange={(e) => setWebsiteUrl(e.target.value)}
        placeholder="Official website URL (optional)"
        className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />

      <label className="mb-1 block text-xs font-bold uppercase text-brand-body">Brand Logo</label>
      <div className="mb-3 flex items-center gap-3">
        {logoUrl && <img src={logoUrl} alt="Logo preview" className="h-14 w-14 rounded-lg object-contain" />}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleLogoFile(file);
          }}
          className="text-xs"
        />
        {uploading && <span className="text-xs text-brand-body">Uploading…</span>}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={saving || uploading}
        className="w-full rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save Brand'}
      </button>
    </div>
  );
}

function ProductForm({ brandId, onSaved }: { brandId: string; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [labCertificateUrl, setLabCertificateUrl] = useState<string | null>(null);
  const [labTestedDate, setLabTestedDate] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImageFile = async (file: File) => {
    setUploadingImage(true);
    setError(null);
    try {
      setImageUrl(await uploadToCloudinary(file));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCertFile = async (file: File) => {
    setUploadingCert(true);
    setError(null);
    try {
      setLabCertificateUrl(await uploadToCloudinary(file));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadingCert(false);
    }
  };

  const submit = async () => {
    if (!name.trim()) {
      setError('Product name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateSupplementProduct({
        brandId,
        name,
        description: description || undefined,
        imageUrl: imageUrl || undefined,
        labCertificateUrl: labCertificateUrl || undefined,
        labTestedDate: labTestedDate || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl bg-brand-bg p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-body">New Product</h3>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Product name (e.g. Gold Standard 100% Whey)"
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Why we picked this product (optional)"
        rows={2}
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />

      <label className="mb-1 block text-xs font-bold uppercase text-brand-body">Product Photo</label>
      <div className="mb-3 flex items-center gap-3">
        {imageUrl && <img src={imageUrl} alt="Product preview" className="h-14 w-14 rounded-lg object-cover" />}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageFile(file);
          }}
          className="text-xs"
        />
        {uploadingImage && <span className="text-xs text-brand-body">Uploading…</span>}
      </div>

      <label className="mb-1 block text-xs font-bold uppercase text-brand-body">Lab Test Certificate</label>
      <div className="mb-2 flex items-center gap-3">
        {labCertificateUrl && (
          <a href={labCertificateUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-primary underline">
            View uploaded certificate
          </a>
        )}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleCertFile(file);
          }}
          className="text-xs"
        />
        {uploadingCert && <span className="text-xs text-brand-body">Uploading…</span>}
      </div>
      <p className="mb-3 text-[10px] text-brand-body">Photograph or scan the certificate as an image (JPG/PNG).</p>

      <input
        type="date"
        value={labTestedDate}
        onChange={(e) => setLabTestedDate(e.target.value)}
        className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={saving || uploadingImage || uploadingCert}
        className="w-full rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save Product'}
      </button>
    </div>
  );
}
