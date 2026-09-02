import type { Metadata } from 'next';
import { siteConfig } from '@/lib/siteConfig';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPolicyPage() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed text-brand-body">
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Privacy Policy</h1>
      <p className="mb-6 text-xs text-brand-body/70">Last updated: [set this date when you publish]</p>

      <div className="mb-8 rounded-xl border-2 border-yellow-400 bg-yellow-50 p-4 text-xs text-yellow-900">
        <strong>Before publishing:</strong> this page accurately describes what {siteConfig.businessName}&apos;s
        software actually does with your data — but it is a starting template, not a substitute for legal advice.
        Have a lawyer review it against your specific jurisdiction&apos;s requirements (India&apos;s DPDP Act,
        GDPR if you serve EU customers, etc.) before you rely on it.
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">What we collect</h2>
      <p className="mb-3">When you create an account and use {siteConfig.businessName}, we collect:</p>
      <ul className="mb-4 ml-5 list-disc space-y-1">
        <li>Your phone number and/or email address (used for login — we never ask for a password)</li>
        <li>Your name and, if you provide it, your gym name (for the optional gym leaderboard)</li>
        <li>Delivery address and contact phone, if you place a delivery order</li>
        <li>Allergy information, if you choose to add it, so we can warn you about products that conflict with it</li>
        <li>Nutrition goals and daily logs you choose to track</li>
        <li>Order history, payment status, and loyalty points/rewards activity</li>
        <li>Messages you send to the AI nutrition assistant, if you use it</li>
        <li>A rider&apos;s live location, only while your specific delivery is out — never stored as a permanent history</li>
      </ul>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">What we don&apos;t collect</h2>
      <p className="mb-4">
        We never see or store your payment card details — those go directly to our payment processor (Razorpay),
        never through our own servers. We don&apos;t use tracking cookies for advertising.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Who we share data with</h2>
      <ul className="mb-4 ml-5 list-disc space-y-1">
        <li><strong>Razorpay</strong> — to process online payments</li>
        <li><strong>Our email/SMS provider</strong> — to send you login codes and order updates</li>
        <li>
          <strong>Anthropic (Claude AI)</strong> — if you use the AI nutrition assistant, your messages to it are sent
          to Anthropic to generate a response
        </li>
      </ul>
      <p className="mb-4">We never sell your data to anyone.</p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Your rights — and how to actually use them</h2>
      <p className="mb-2">Unlike a lot of privacy policies, these aren&apos;t just promises — they&apos;re real buttons in your account:</p>
      <ul className="mb-4 ml-5 list-disc space-y-1">
        <li><strong>Download your data</strong> — Account Settings → Download My Data, gives you a full export</li>
        <li><strong>Delete your account</strong> — Account Settings → Delete My Account, removes your profile and health/allergy data immediately</li>
        <li><strong>Change your phone/email</strong> — Account Settings, OTP-verified</li>
        <li><strong>Opt out of marketing</strong> — Account Settings, without affecting order confirmations or login codes</li>
      </ul>
      <p className="mb-4">
        One exception, stated plainly: we keep your order and payment records even after you delete your account —
        most jurisdictions legally require retaining financial records regardless of a deletion request. Once your
        profile is deleted, those records no longer carry your name or contact details.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Contact us</h2>
      <p>Questions about this policy? Reach us through the contact details on our homepage.</p>
    </section>
  );
}
