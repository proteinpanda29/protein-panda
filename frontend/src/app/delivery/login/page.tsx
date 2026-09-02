import { LoginForm } from '@/components/LoginForm';
import { siteConfig } from '@/lib/siteConfig';

export default function DeliveryLoginPage() {
  return (
    <LoginForm
      portal="DELIVERY"
      title={`🛵 ${siteConfig.businessName} Delivery`}
      subtitle="Rider login — enter the phone or email your delivery account was set up with."
      allowSignup={false}
      redirectPath="/delivery"
      wrongPortalHint="This account isn't a delivery account. Customers should use the regular login page."
    />
  );
}
