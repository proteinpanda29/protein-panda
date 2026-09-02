import Image from 'next/image';
import { siteConfig } from '@/lib/siteConfig';

const ctas = [
  { label: 'Order Now', href: '/menu', primary: true },
  { label: 'Track My Nutrition', href: '/nutrition', primary: false },
  { label: 'Play & Earn', href: '/games', primary: false },
];

const pillars = [
  { icon: '🥤', title: 'Protein Shakes', desc: 'Whey, veg & non-veg options, fully customisable.', href: '/menu' },
  { icon: '🥣', title: 'Diet Food', desc: 'Protein oats, boiled eggs, omelettes, clean snacks.', href: '/menu' },
  { icon: '📊', title: 'Nutrition Tracking', desc: 'Daily protein, calories, carbs, fat & fibre — automatically.', href: '/nutrition' },
  { icon: '🔥', title: 'Daily Streaks', desc: 'Stay consistent, unlock milestone rewards.', href: '/nutrition' },
  { icon: '🎮', title: 'Shop Games', desc: 'Hanging challenge, plank, push-ups — earn points in-store.', href: '/games' },
  { icon: '🏆', title: 'Leaderboards', desc: 'Compete for Protein Champion of the month.', href: '/leaderboard' },
];

export default function HomePage() {
  // LocalBusiness structured data — real search engines use this for
  // rich results (business name, category) directly in search. Kept to
  // static siteConfig values only, deliberately not fetched from
  // ShopSettings at request time: this is the homepage, and it should
  // never fail to render because a backend API call hiccuped. Fill in
  // your real street address/phone/hours once you have them, or wire
  // this to a live ShopSettings fetch if you're comfortable making the
  // homepage depend on the backend being reachable — a real tradeoff,
  // not an oversight.
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'FoodEstablishment',
    name: siteConfig.businessName,
    description: siteConfig.tagline,
    servesCuisine: 'Protein shakes and nutrition food',
    priceRange: '₹₹',
  };

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      {/* Hero */}
      <section className="border-b border-brand-grey bg-brand-bg">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-4 py-16 text-center">
          <Image
            src="/brand/logo.jpg"
            alt={siteConfig.businessName}
            width={180}
            height={180}
            className="rounded-full"
            priority
          />
          <div>
            <h1 className="text-4xl font-extrabold uppercase tracking-tight text-brand-black md:text-6xl">
              {siteConfig.businessName}
            </h1>
            <p className="mt-3 text-lg font-semibold uppercase tracking-wide text-brand-body">
              {siteConfig.tagline}
            </p>
          </div>
          <p className="max-w-xl text-brand-body">
            Clean ingredients, affordable pricing, and a nutrition + loyalty platform connected
            to your shop — order, track your protein, play in-store challenges, and earn rewards.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {ctas.map((cta) => (
              <a
                key={cta.label}
                href={cta.href}
                className={
                  cta.primary
                    ? 'rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white transition-colors hover:bg-brand-accent'
                    : 'rounded-full border-2 border-brand-black px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-black transition-colors hover:border-brand-primary hover:text-brand-primary'
                }
              >
                {cta.label}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="mb-10 text-center text-2xl font-extrabold uppercase tracking-tight text-brand-black">
          Eat Clean · Stay Strong · Be Better
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p) => (
            <a
              key={p.title}
              href={p.href}
              className="block rounded-2xl border border-brand-grey bg-brand-white p-6 shadow-sm transition-shadow hover:border-brand-primary hover:shadow-md"
            >
              <div className="mb-3 text-3xl">{p.icon}</div>
              <h3 className="mb-1 text-lg font-bold text-brand-black">{p.title}</h3>
              <p className="text-sm text-brand-body">{p.desc}</p>
            </a>
          ))}
        </div>
      </section>

      {/* Streak / points teaser strip */}
      <section className="bg-brand-black py-14 text-brand-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-accent">
            Lab Tested · Fresh Ingredients · Affordable Prices
          </p>
          <h3 className="text-2xl font-extrabold uppercase tracking-tight md:text-3xl">
            Every order builds your streak, your protein progress, and your points.
          </h3>
          <a
            href="/login"
            className="mt-2 rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white transition-colors hover:bg-brand-accent"
          >
            Create your account
          </a>
        </div>
      </section>
    </>
  );
}
