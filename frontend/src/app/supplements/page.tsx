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
}

interface SupplementBrand {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  supplements: SupplementProduct[];
}

export default function SupplementsPage() {
  const [brands, setBrands] = useState<SupplementBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSupplementBrands()
      .then(setBrands)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Supplements We Use</h1>
      <p className="mb-6 text-sm text-brand-body">
        Full transparency — the exact brands and products we use, with real lab-test certificates for each.
      </p>

      {loading && <p className="text-sm text-brand-body">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && brands.length === 0 && !error && (
        <p className="text-sm text-brand-body">Nothing published here yet — check back soon.</p>
      )}

      <div className="flex flex-col gap-6">
        {brands.map((brand) => (
          <div key={brand.id} className="rounded-2xl border border-brand-grey bg-brand-white p-5">
            <div className="mb-3 flex items-center gap-3">
              {brand.logoUrl && <img src={brand.logoUrl} alt={brand.name} className="h-12 w-12 rounded-lg object-contain" />}
              <div>
                <h2 className="text-lg font-bold text-brand-black">{brand.name}</h2>
                {brand.websiteUrl && (
                  <a href={brand.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-primary underline">
                    Official website
                  </a>
                )}
              </div>
            </div>
            {brand.description && <p className="mb-4 text-sm text-brand-body">{brand.description}</p>}

            <div className="flex flex-col gap-3">
              {brand.supplements.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl bg-brand-bg p-3">
                  {s.imageUrl && <img src={s.imageUrl} alt={s.name} className="h-14 w-14 rounded-lg object-cover" />}
                  <div className="flex-1">
                    <p className="text-sm font-bold text-brand-black">{s.name}</p>
                    {s.description && <p className="text-xs text-brand-body">{s.description}</p>}
                    {s.labTestedDate && (
                      <p className="text-[10px] text-brand-body">Lab tested: {new Date(s.labTestedDate).toLocaleDateString()}</p>
                    )}
                  </div>
                  {s.labCertificateUrl && (
                  
                     <a href={s.labCertificateUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="whitespace-nowrap rounded-full bg-brand-primary px-3 py-1.5 text-[10px] font-bold uppercase text-brand-white"
                    >
                      🧪 View Certificate
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
