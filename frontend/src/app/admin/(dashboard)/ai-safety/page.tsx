'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface SafetyFlag {
  id: string;
  categories: string[];
  messageExcerpt: string;
  createdAt: string;
  customer: { name: string };
}

const CATEGORY_LABEL: Record<string, string> = {
  PREGNANCY: 'Pregnancy',
  DIABETES: 'Diabetes',
  KIDNEY_DISEASE: 'Kidney disease',
  LIVER_DISEASE: 'Liver disease',
  MEDICATION: 'Medication',
  SEVERE_ALLERGY: 'Severe allergy',
  CHILDREN: "Child's diet",
};

export default function AdminAiSafetyPage() {
  const [flags, setFlags] = useState<SafetyFlag[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminAiSafetyFlags().then(setFlags).catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-sm text-brand-body">Couldn&apos;t load the safety log. ({error})</p>;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">AI Safety Log</h1>
      <p className="mb-6 max-w-2xl text-sm text-brand-body">
        Every time a customer asks the AI assistant something touching pregnancy, diabetes, kidney/liver disease,
        medication, a severe allergy, or a child&apos;s diet, the assistant is instructed to avoid giving specific
        medical numbers and to point them to a doctor instead — and it&apos;s logged here so you have real visibility
        into how often this comes up, not just a hope that the prompt alone is enough.
      </p>

      {flags.length === 0 ? (
        <p className="text-sm text-brand-body">No flagged conversations yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {flags.map((f) => (
            <div key={f.id} className="rounded-2xl border border-yellow-300 bg-yellow-50 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-brand-black">{f.customer.name}</p>
                <p className="text-xs text-brand-body">{new Date(f.createdAt).toLocaleString()}</p>
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {f.categories.map((c) => (
                  <span key={c} className="rounded-full bg-yellow-600 px-2 py-1 text-xs font-bold text-white">
                    {CATEGORY_LABEL[c] ?? c}
                  </span>
                ))}
              </div>
              <p className="text-sm italic text-brand-body">&ldquo;{f.messageExcerpt}&rdquo;</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
