'use client';

import { useRef, useState } from 'react';
import { siteConfig } from '@/lib/siteConfig';

interface Achievement {
  name: string;
  description: string;
  icon: string;
}

export function AchievementShareCard({ achievement, onClose }: { achievement: Achievement; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const renderToBlob = async (): Promise<Blob | null> => {
    if (!cardRef.current) return null;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(cardRef.current, { backgroundColor: null, scale: 2 });
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  };

  const download = async () => {
    setBusy(true);
    try {
      const blob = await renderToBlob();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `protein-panda-${achievement.name.toLowerCase().replace(/\s+/g, '-')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setBusy(true);
    try {
      const blob = await renderToBlob();
      if (!blob) return;
      const file = new File([blob], 'protein-panda-achievement.png', { type: 'image/png' });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${siteConfig.businessName} Achievement`,
          text: `I just unlocked "${achievement.name}" on ${siteConfig.businessName}! ${siteConfig.mascotEmoji}`,
        });
      } else {
        await download();
      }
    } catch {
      // user cancelled the share sheet — not an error
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <div
          ref={cardRef}
          className="flex h-[420px] w-[340px] flex-col items-center justify-center gap-4 rounded-3xl border-4 border-brand-primary bg-gradient-to-b from-brand-black to-brand-charcoal p-8 text-center"
        >
          <span className="text-6xl">{achievement.icon}</span>
          <p className="text-xs font-bold uppercase tracking-widest text-brand-accent">Achievement Unlocked</p>
          <p className="text-2xl font-extrabold text-brand-white">{achievement.name}</p>
          <p className="text-sm text-brand-grey">{achievement.description}</p>
          <p className="mt-4 text-lg font-extrabold tracking-tight text-brand-white">
            PROTEIN <span className="text-brand-accent">PANDA</span> 🐼
          </p>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            onClick={share}
            disabled={busy}
            className="rounded-full bg-brand-primary px-5 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
          >
            {busy ? 'Preparing…' : '📤 Share'}
          </button>
          <button
            onClick={download}
            disabled={busy}
            className="rounded-full border-2 border-brand-white px-5 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:border-brand-accent hover:text-brand-accent disabled:opacity-60"
          >
            ⬇ Download
          </button>
          <button
            onClick={onClose}
            className="rounded-full border-2 border-brand-white/40 px-5 py-3 text-sm font-bold uppercase tracking-wide text-brand-white/70 hover:border-brand-white hover:text-brand-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
