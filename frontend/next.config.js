/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  async headers() {
    return [
      {
        // Applies to every route — real security headers for a page
        // that actually serves HTML (unlike the backend API, which
        // only serves JSON and doesn't need a content policy).
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' }, // no embedding this site in another page's iframe (clickjacking protection)
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' }, // geolocation stays available for delivery-address features
        ],
      },
    ];
  },
};

module.exports = nextConfig;
