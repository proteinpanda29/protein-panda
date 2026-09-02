import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ============================================================
        // BRAND PALETTE — these reference CSS custom properties (set
        // at runtime by BrandThemeInjector from ShopSettings, admin-
        // editable at /admin/settings) with the original Protein Panda
        // values as fallbacks. An admin can re-theme the whole site's
        // colors from the settings page with NO code changes and NO
        // rebuild — this file only matters if you want to change the
        // out-of-the-box fallback shown before any admin customizes it.
        // ============================================================
        'brand-black': '#080808',
        'brand-charcoal': '#171717',
        'brand-primary': 'var(--brand-primary, #6F8615)',
        'brand-accent': 'var(--brand-accent, #82A51B)',
        'brand-bg': 'var(--brand-bg, #F3F0E7)',
        'brand-white': '#FFFFFF',
        'brand-grey': '#D9D9D2',
        'brand-body': '#252525',
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
