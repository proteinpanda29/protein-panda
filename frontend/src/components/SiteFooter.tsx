'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { siteConfig } from '@/lib/siteConfig';

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2c2.717 0 3.056.01 4.122.06 1.065.05 1.79.217 2.428.465.66.256 1.216.598 1.772 1.153a4.908 4.908 0 0 1 1.153 1.772c.247.637.415 1.363.465 2.428.048 1.066.06 1.405.06 4.122 0 2.717-.01 3.056-.06 4.122-.05 1.065-.218 1.79-.465 2.428a4.883 4.883 0 0 1-1.153 1.772 4.915 4.915 0 0 1-1.772 1.153c-.637.247-1.363.415-2.428.465-1.066.048-1.405.06-4.122.06-2.717 0-3.056-.01-4.122-.06-1.065-.05-1.79-.218-2.428-.465a4.89 4.89 0 0 1-1.772-1.153 4.904 4.904 0 0 1-1.153-1.772c-.248-.637-.415-1.363-.465-2.428C2.013 15.056 2 14.717 2 12c0-2.717.01-3.056.06-4.122.05-1.066.217-1.79.465-2.428a4.88 4.88 0 0 1 1.153-1.772A4.897 4.897 0 0 1 5.45 2.525c.638-.248 1.362-.415 2.428-.465C8.944 2.012 9.283 2 12 2Zm0 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 8.25a3.25 3.25 0 1 1 0-6.5 3.25 3.25 0 0 1 0 6.5ZM18.4 6.6a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0Z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M22 12.06C22 6.505 17.523 2 12 2S2 6.505 2 12.06c0 5.02 3.657 9.184 8.438 9.94v-7.03H7.898v-2.91h2.54V9.845c0-2.507 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.462h-1.26c-1.243 0-1.63.771-1.63 1.562v1.877h2.773l-.443 2.91h-2.33V22c4.78-.756 8.437-4.92 8.437-9.94Z" />
    </svg>
  );
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M23.5 6.19a3.02 3.02 0 0 0-2.122-2.136C19.505 3.5 12 3.5 12 3.5s-7.505 0-9.378.554A3.02 3.02 0 0 0 .5 6.19C0 8.077 0 12 0 12s0 3.923.5 5.81a3.02 3.02 0 0 0 2.122 2.136C4.495 20.5 12 20.5 12 20.5s7.505 0 9.378-.554A3.02 3.02 0 0 0 23.5 17.81C24 15.923 24 12 24 12s0-3.923-.5-5.81ZM9.6 15.6V8.4L15.84 12 9.6 15.6Z" />
    </svg>
  );
}

interface ShopStatus {
  contactPhone: string | null;
  contactEmail: string | null;
  whatsappNumber: string | null;
  address: string | null;
  mapsUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  youtubeUrl: string | null;
  fssaiNumber: string | null;
}

export function SiteFooter() {
  const [shop, setShop] = useState<ShopStatus | null>(null);

  useEffect(() => {
    api.getShopStatus().then(setShop).catch(() => undefined);
  }, []);

  const socialLinks = [
    { url: shop?.instagramUrl, label: 'Instagram', Icon: InstagramIcon },
    { url: shop?.facebookUrl, label: 'Facebook', Icon: FacebookIcon },
    { url: shop?.youtubeUrl, label: 'YouTube', Icon: YouTubeIcon },
  ].filter((s) => s.url);

  return (
    <footer className="mt-16 bg-brand-black py-10 text-brand-grey">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 sm:grid-cols-3">
        <div>
          <p className="mb-2 text-lg font-extrabold text-brand-white">{siteConfig.businessName.toUpperCase()}</p>
          <p className="text-sm">{siteConfig.tagline}</p>
          {socialLinks.length > 0 && (
            <div className="mt-4 flex gap-3">
              {socialLinks.map((s) => (
                <a key={s.label} href={s.url!} target="_blank" rel="noreferrer" className="text-brand-grey hover:text-brand-white" title={s.label}>
                  <s.Icon className="h-5 w-5" />
                </a>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-accent">Contact</p>
          <div className="flex flex-col gap-1 text-sm">
            {shop?.contactPhone && <a href={`tel:${shop.contactPhone}`} className="hover:text-brand-white">📞 {shop.contactPhone}</a>}
            {shop?.contactEmail && <a href={`mailto:${shop.contactEmail}`} className="hover:text-brand-white">✉️ {shop.contactEmail}</a>}
            {shop?.address && <span>📍 {shop.address}</span>}
            {shop?.mapsUrl && (
              <a href={shop.mapsUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-accent hover:text-brand-white">
                Get Directions →
              </a>
            )}
            {shop?.whatsappNumber && (
              <a
                href={`https://wa.me/${shop.whatsappNumber}?text=${encodeURIComponent(`Hi ${siteConfig.businessName}! I want to place an order.`)}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex w-fit items-center gap-2 rounded-full bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-500"
              >
                💬 Order on WhatsApp
              </a>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-accent">Support</p>
          <div className="flex flex-col gap-1 text-sm">
            <a href="/orders" className="hover:text-brand-white">Order Support</a>
            <a href="/assistant" className="hover:text-brand-white">Ask the AI Assistant</a>
            {shop?.contactEmail && <a href={`mailto:${shop.contactEmail}?subject=Support Request`} className="hover:text-brand-white">Report an Issue</a>}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-6xl flex-wrap justify-center gap-4 border-t border-brand-grey/20 px-4 pt-6 text-xs">
        <a href="/privacy-policy" className="hover:text-brand-white">Privacy Policy</a>
        <a href="/terms" className="hover:text-brand-white">Terms of Service</a>
        <a href="/refund-policy" className="hover:text-brand-white">Refund &amp; Cancellation Policy</a>
      </div>

      <p className="mt-4 text-center text-xs text-brand-grey/60">
        © {new Date().getFullYear()} {siteConfig.businessName}. All rights reserved.
        {shop?.fssaiNumber && <> · FSSAI Lic. No. {shop.fssaiNumber}</>}
      </p>
    </footer>
  );
}
