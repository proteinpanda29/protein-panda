'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';

/**
 * Fetches ShopSettings once on mount and applies primaryColorHex/
 * accentColorHex/backgroundColorHex as CSS custom properties on the
 * document root. tailwind.config.ts's brand-primary/brand-accent/
 * brand-bg tokens read these same variable names (with the original
 * Protein Panda hex values as a fallback) — so an admin changing colors
 * in Settings re-themes the entire site immediately, no rebuild.
 *
 * Renders nothing — this is a side-effect-only component, mounted once
 * near the top of the root layout.
 */
export function BrandThemeInjector() {
  useEffect(() => {
    api
      .getShopStatus()
      .then((settings) => {
        const root = document.documentElement.style;
        if (settings.primaryColorHex) root.setProperty('--brand-primary', settings.primaryColorHex);
        if (settings.accentColorHex) root.setProperty('--brand-accent', settings.accentColorHex);
        if (settings.backgroundColorHex) root.setProperty('--brand-bg', settings.backgroundColorHex);
      })
      .catch(() => undefined); // fall back to the Tailwind config's default colors
  }, []);

  return null;
}
