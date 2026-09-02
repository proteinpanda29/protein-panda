import type { Metadata, Viewport } from 'next';
import './globals.css';
import { CartProvider } from '@/lib/cart-context';
import { NavCartLink } from '@/components/NavCartLink';
import { ShopStatusBar } from '@/components/ShopStatusBar';
import { MobileNav } from '@/components/MobileNav';
import { SiteFooter } from '@/components/SiteFooter';
import { FloatingAssistant } from '@/components/FloatingAssistant';
import { BrandThemeInjector } from '@/components/BrandThemeInjector';
import { NavAuthButton } from '@/components/NavAuthButton';
import { CustomerNavLinks } from '@/components/CustomerNavLinks';
import { siteConfig } from '@/lib/siteConfig';

/**
 * NEXT_PUBLIC_SITE_URL needs a protocol (https://) to be a valid URL —
 * `new URL()` throws otherwise. Found this the hard way: someone
 * setting the env var as a bare domain (a genuinely easy typo on a
 * hosting platform, not an unreasonable thing to do) crashed the
 * ENTIRE production build, not just this one page — a single missing
 * "https://" shouldn't be able to take down a deployment. This
 * normalizes a bare domain by assuming https, and falls back to
 * localhost if the value is missing entirely or somehow still invalid.
 */
function resolveSiteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol);
  } catch {
    return new URL('http://localhost:3000');
  }
}

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.businessName} — ${siteConfig.tagline}`,
    // Individual pages set their own title via generateMetadata and
    // this template wraps it — e.g. "Menu | Protein Panda" instead of
    // every single page just saying the business name over and over,
    // which is a common, real, easy-to-miss SEO mistake.
    template: `%s | ${siteConfig.businessName}`,
  },
  description: 'Nutrition + loyalty + fitness engagement. Order, track, play, earn.',
  manifest: '/manifest.json',
  metadataBase: resolveSiteUrl(),
  openGraph: {
    title: `${siteConfig.businessName} — ${siteConfig.tagline}`,
    description: 'Order fresh protein shakes, track your nutrition, and earn rewards.',
    siteName: siteConfig.businessName,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteConfig.businessName} — ${siteConfig.tagline}`,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#080808',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* flex flex-col + main flex-1 keeps the footer pinned to the bottom
          on short pages instead of floating in the middle of the viewport */}
      <body className="flex min-h-screen flex-col bg-brand-bg text-brand-body font-display">
        <BrandThemeInjector />
        <CartProvider>
          <header className="sticky top-0 z-50 bg-brand-black text-brand-white">
            <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <a href="/" className="flex items-center gap-2">
                <span className="text-lg font-extrabold tracking-tight">
                  {siteConfig.businessName.toUpperCase()}
                </span>
              </a>

              {/* Hidden for staff/rider roles — they have their own dashboards */}
              <CustomerNavLinks />

              <div className="flex items-center gap-3">
                <NavCartLink />
                <NavAuthButton />
                <MobileNav />
              </div>
            </nav>
          </header>
          <ShopStatusBar />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <FloatingAssistant />
        </CartProvider>
      </body>
    </html>
  );
}
