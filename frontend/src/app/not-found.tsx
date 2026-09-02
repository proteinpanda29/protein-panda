import { siteConfig } from '@/lib/siteConfig';

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <p className="mb-2 text-6xl">{siteConfig.mascotEmoji || '🔍'}</p>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Page Not Found</h1>
      <p className="mb-6 text-sm text-brand-body">
        This page doesn't exist — it may have been moved, or the link might be out of date.
      </p>
      <a
        href="/"
        className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
      >
        Back to {siteConfig.businessName}
      </a>
    </section>
  );
}
