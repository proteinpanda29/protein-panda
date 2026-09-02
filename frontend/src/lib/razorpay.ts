let loadingPromise: Promise<void> | null = null;

export function loadRazorpayScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).Razorpay) return Promise.resolve();

  if (!loadingPromise) {
    loadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Razorpay checkout script'));
      document.body.appendChild(script);
    });
  }

  return loadingPromise;
}

/**
 * Opens Razorpay checkout for an EXISTING order — extracted so both the
 * initial checkout flow and a "Pay Now" retry (for an order whose
 * payment was interrupted — modal closed, network blip, etc.) use the
 * exact same real, tested flow rather than two separate
 * implementations that could drift apart. Genuinely needed: checkout's
 * own error message already told customers "you can retry from My
 * Orders" — but that retry button never actually existed anywhere
 * until this was built.
 */
export async function payForOrder(params: {
  api: { createRazorpayOrder: (orderId: string) => Promise<any>; verifyPayment: (p: any) => Promise<any> };
  orderId: string;
  businessName: string;
  primaryColorHex: string;
  onStage: (stage: string | null) => void;
  onSuccess: () => void;
  onError: (message: string) => void;
  onDismiss?: () => void;
}) {
  const { api, orderId, businessName, primaryColorHex, onStage, onSuccess, onError, onDismiss } = params;

  try {
    onStage('Opening secure payment…');
    await loadRazorpayScript();
    const rzpOrder = await api.createRazorpayOrder(orderId);

    const razorpay = new (window as any).Razorpay({
      key: rzpOrder.keyId,
      amount: rzpOrder.amountPaise,
      currency: rzpOrder.currency,
      name: businessName,
      description: `Order #${rzpOrder.orderNumber}`,
      order_id: rzpOrder.razorpayOrderId,
      theme: { color: primaryColorHex },
      handler: async (response: any) => {
        onStage('Confirming payment…');
        try {
          await api.verifyPayment({
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });
          onSuccess();
        } catch (err: any) {
          onError(err.message ?? 'Payment could not be confirmed. Contact support with your order number.');
        } finally {
          onStage(null);
        }
      },
      modal: {
        ondismiss: () => {
          onStage(null);
          onDismiss?.();
        },
      },
    });
    razorpay.open();
  } catch (err: any) {
    onStage(null);
    onError(err.message ?? 'Could not open payment');
  }
}
