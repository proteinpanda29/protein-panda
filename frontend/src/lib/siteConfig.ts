/**
 * SITE CONFIGURATION — edit these values to re-brand the entire site.
 *
 * This is the one place that should need editing for TEXT branding
 * (business name, tagline, mascot). Every page imports from here
 * instead of hardcoding "Protein Panda" or 🐼 directly.
 *
 * For COLOR branding, see /frontend/tailwind.config.ts instead — the
 * two are deliberately separate files since one is TypeScript values
 * and the other is Tailwind's color config format.
 *
 * Values can also be overridden via environment variables (useful for
 * deploying the same codebase for multiple businesses without editing
 * this file per-deployment) — see the NEXT_PUBLIC_* fallbacks below.
 */
export const siteConfig = {
  /** The business name, shown in the nav, page titles, emails, and throughout the UI. */
  businessName: process.env.NEXT_PUBLIC_BUSINESS_NAME ?? 'Protein Panda',

  /** Short tagline shown on the homepage hero and in metadata. */
  tagline: process.env.NEXT_PUBLIC_TAGLINE ?? 'Fuel your gains, one shake at a time.',

  /**
   * The mascot emoji used throughout the UI (nav logo, chat assistant,
   * order confirmations, etc). Set to '' to disable mascot emoji
   * entirely — components check for a falsy value and omit it cleanly
   * rather than rendering an empty space.
   */
  mascotEmoji: process.env.NEXT_PUBLIC_MASCOT_EMOJI ?? '🐼',

  /** Currency symbol used everywhere a price is displayed. */
  currencySymbol: process.env.NEXT_PUBLIC_CURRENCY_SYMBOL ?? '₹',

  /** Name of the AI nutrition assistant persona, shown in the chat widget. */
  assistantName: process.env.NEXT_PUBLIC_ASSISTANT_NAME ?? 'Panda Assistant',

  /**
   * Primary brand color as a raw hex value — for contexts that can't use
   * Tailwind classes (e.g. the Razorpay checkout modal's `theme.color`
   * option, which only accepts a literal hex string). Keep this in sync
   * with 'brand-primary' in tailwind.config.ts if you change the color
   * there — the two are necessarily separate since one is Tailwind's
   * config format and the other is a plain JS value.
   */
  primaryColorHex: process.env.NEXT_PUBLIC_PRIMARY_COLOR_HEX ?? '#6F8615',
} as const;
