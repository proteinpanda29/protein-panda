import type { Metadata } from 'next';
import { siteConfig } from '@/lib/siteConfig';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed text-brand-body">
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Terms of Service</h1>
      <p className="mb-6 text-xs text-brand-body/70">Last updated: [set this date when you publish]</p>

      <div className="mb-8 rounded-xl border-2 border-yellow-400 bg-yellow-50 p-4 text-xs text-yellow-900">
        <strong>Before publishing:</strong> a starting template reflecting how this app actually works — have a
        lawyer review it for your jurisdiction (consumer protection law, food-service regulations, FSSAI
        requirements if applicable) before you rely on it.
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Your account</h2>
      <p className="mb-4">
        Accounts are verified by a one-time code sent to your phone or email — there are no passwords to create or
        remember. You&apos;re responsible for keeping access to that phone number or email account secure, since
        it&apos;s what controls your login.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Orders</h2>
      <p className="mb-4">
        Placing an order is an offer to buy at the price shown at checkout. We&apos;ll confirm your order once
        it&apos;s accepted. You can cancel an order yourself from the Orders page while it&apos;s still marked
        &quot;Received&quot; or &quot;Accepted&quot; — once we&apos;ve started preparing it, please contact us
        directly instead, since self-cancellation is no longer available at that point.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Allergens</h2>
      <p className="mb-4">
        If you record an allergy on your profile, we&apos;ll warn you before you order anything that conflicts with
        it — but you&apos;re responsible for reviewing ingredients yourself, especially for anything not listed on
        your profile. Please tell our staff directly about any serious/anaphylactic allergy when placing an in-store
        order.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Points, rewards, and membership</h2>
      <p className="mb-4">
        Points earned through orders, games, or streaks can be redeemed for rewards at our discretion — reward
        availability and point values may change. Membership subscriptions renew automatically until cancelled from
        your Membership page.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">The AI nutrition assistant</h2>
      <p className="mb-4">
        Our AI assistant gives general nutrition guidance based on our menu — it does not replace advice from a
        doctor or registered dietitian, and it will not give specific medical guidance for pregnancy, diabetes,
        kidney/liver conditions, medication interactions, or a child&apos;s diet. Please consult a qualified
        professional for anything in those categories.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Changes to these terms</h2>
      <p>We may update these terms from time to time. Continued use of {siteConfig.businessName} after a change means you accept the updated terms.</p>
    </section>
  );
}
