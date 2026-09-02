import { LoginForm } from '@/components/LoginForm';
import { siteConfig } from '@/lib/siteConfig';

export default function AdminLoginPage() {
  return (
    <LoginForm
      portal="ADMIN"
      title={`${siteConfig.mascotEmoji} ${siteConfig.businessName} Admin`}
      subtitle="Staff login — enter the phone or email your admin account was set up with."
      allowSignup={false}
      redirectPath="/admin"
      wrongPortalHint="This account isn't an admin account. Customers should use the regular login page."
    />
  );
}
