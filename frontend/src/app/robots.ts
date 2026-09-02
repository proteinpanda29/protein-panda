import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Nothing here should ever show up in search results — an
        // admin/delivery login page or dashboard indexed by Google is a
        // real information-leak risk (even just confirming these routes
        // exist), not just a cosmetic SEO concern.
        disallow: ['/admin', '/delivery', '/api', '/account', '/orders', '/notifications', '/support'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
