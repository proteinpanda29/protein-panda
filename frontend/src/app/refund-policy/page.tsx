import type { Metadata } from 'next';
import { siteConfig } from '@/lib/siteConfig';

export const metadata: Metadata = { title: 'Refund & Cancellation Policy' };

export default function RefundPolicyPage() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed text-brand-body">
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">
        Refund &amp; Cancellation Policy
      </h1>
      <p className="mb-6 text-xs text-brand-body/70">Last updated: [set this date when you publish]</p>

      <div className="mb-8 rounded-xl border-2 border-yellow-400 bg-yellow-50 p-4 text-xs text-yellow-900">
        <strong>Before publishing:</strong> Razorpay requires a live Refund/Cancellation Policy page as part of
        their business verification — this template matches how {siteConfig.businessName}&apos;s actual refund
        system works, but confirm the specific wording satisfies your payment gateway&apos;s requirements and any
        local consumer-protection law before publishing.
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Cancelling an order yourself</h2>
      <p className="mb-4">
        You can cancel an order from the Orders page for free, without contacting us, as long as it&apos;s still
        marked &quot;Received&quot; or &quot;Accepted.&quot; Once we&apos;ve started preparing it, self-cancellation
        is no longer available — please contact us directly and we&apos;ll do what we can.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">How refunds are issued</h2>
      <p className="mb-4">A refund always goes back through the same method you originally paid with:</p>
      <ul className="mb-4 ml-5 list-disc space-y-1">
        <li>
          <strong>Paid online (UPI/card)</strong> — refunded automatically to your original payment method through
          Razorpay. Processing time depends on your bank, typically 5–7 business days.
        </li>
        <li>
          <strong>Paid cash</strong> — refunded in cash at the counter, confirmed by our staff.
        </li>
      </ul>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Points and rewards on a cancelled/refunded order</h2>
      <p className="mb-4">
        Any loyalty points earned on an order are automatically reversed if that order is cancelled or refunded —
        you won&apos;t end up keeping points for an order you didn&apos;t actually keep.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Delivery issues</h2>
      <p className="mb-4">
        If a delivery genuinely couldn&apos;t be completed (you were unavailable, the address was wrong, or another
        delivery issue came up), we&apos;ll contact you to sort it out — a refund, a redelivery, or another
        resolution depending on the situation.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-bold text-brand-black">Questions about a specific order</h2>
      <p>
        Use the Support section in the app, or reach us through the contact details on our homepage — every refund
        request is reviewed individually.
      </p>
    </section>
  );
}
