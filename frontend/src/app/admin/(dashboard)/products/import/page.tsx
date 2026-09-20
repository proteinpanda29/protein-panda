'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';

interface ImportItem {
  category: string;
  name: string;
  priceRs: number;
  isVeg?: boolean;
  description?: string;
  nutrition?: Record<string, number>;
}

interface ImportResult {
  totalItems: number;
  created: number;
  updated: number;
  failed: number;
  results: { name: string; status: 'created' | 'updated' | 'failed'; error?: string }[];
}

export default function MenuImportPage() {
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelected = async (file: File) => {
    setParseError(null);
    setResult(null);
    setError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const parsedItems: ImportItem[] = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(parsedItems)) {
        throw new Error('Expected either a JSON array of items, or an object with an "items" array');
      }
      setItems(parsedItems);
    } catch (err: any) {
      setItems(null);
      setParseError(err.message ?? 'Could not read this file as valid JSON');
    }
  };

  const runImport = async () => {
    if (!items) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.adminBulkImportMenu(items);
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const categoryCount = items ? new Set(items.map((i) => i.category)).size : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Bulk Menu Import</h1>
      <p className="mb-6 text-sm text-brand-body">
        Upload a JSON file to add or update many menu items at once — new categories are created automatically, and
        re-uploading the same file after editing a price or nutrition value updates that item in place instead of
        creating a duplicate.
      </p>

      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) handleFileSelected(file);
        }}
        className="mb-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-grey bg-brand-white p-10 text-center hover:border-brand-primary"
      >
        <p className="mb-1 text-4xl">📄</p>
        <p className="text-sm font-bold text-brand-black">{fileName || 'Click to choose a .json file, or drag one here'}</p>
        <p className="mt-1 text-xs text-brand-body">A JSON array of items, or an object with an "items" array</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelected(file);
          }}
        />
      </div>

      {parseError && <p className="mb-4 text-sm text-red-600">Couldn&apos;t read that file: {parseError}</p>}

      {items && !result && (
        <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
          <p className="mb-3 text-sm font-bold text-brand-black">
            Found {items.length} item{items.length === 1 ? '' : 's'} across {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}
          </p>
          <div className="mb-4 max-h-64 overflow-y-auto rounded-xl bg-brand-bg p-3">
            {items.slice(0, 20).map((item, i) => (
              <p key={i} className="text-xs text-brand-body">
                <span className="font-semibold text-brand-black">{item.category}</span> — {item.name} · ₹{item.priceRs}
              </p>
            ))}
            {items.length > 20 && <p className="mt-1 text-xs text-brand-body">…and {items.length - 20} more</p>}
          </div>
          {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
          <button
            onClick={runImport}
            disabled={importing}
            className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-50"
          >
            {importing ? 'Importing…' : `Import ${items.length} Items`}
          </button>
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-brand-bg p-3">
              <p className="text-xl font-extrabold text-brand-black">{result.created}</p>
              <p className="text-[10px] uppercase text-brand-body">Created</p>
            </div>
            <div className="rounded-xl bg-brand-bg p-3">
              <p className="text-xl font-extrabold text-brand-black">{result.updated}</p>
              <p className="text-[10px] uppercase text-brand-body">Updated</p>
            </div>
            <div className="rounded-xl bg-brand-bg p-3">
              <p className={`text-xl font-extrabold ${result.failed > 0 ? 'text-red-600' : 'text-brand-black'}`}>{result.failed}</p>
              <p className="text-[10px] uppercase text-brand-body">Failed</p>
            </div>
          </div>

          {result.failed > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-bold uppercase text-red-600">Failed Items</p>
              <div className="flex flex-col gap-1">
                {result.results
                  .filter((r) => r.status === 'failed')
                  .map((r, i) => (
                    <p key={i} className="text-xs text-red-600">
                      {r.name}: {r.error}
                    </p>
                  ))}
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setItems(null);
              setResult(null);
              setFileName('');
            }}
            className="w-full rounded-full border-2 border-brand-black py-3 text-sm font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
          >
            Import Another File
          </button>
        </div>
      )}
    </div>
  );
}
