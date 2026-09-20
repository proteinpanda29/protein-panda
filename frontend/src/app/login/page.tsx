import { LoginForm } from '@/components/LoginForm';
import { siteConfig } from '@/lib/siteConfig';

export default async function CustomerLoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string; ref?: string }> }) {
  const params = await searchParams;
  return (
    <LoginForm
      portal="CUSTOMER"
      title={`Welcome to ${siteConfig.businessName}`}
      subtitle={
        params.ref
          ? "A friend invited you! Sign up with your mobile number or email to claim your welcome bonus."
          : 'Log in or sign up with your mobile number or email — just a one-time code, no password.'
      }
      allowSignup
      redirectPath={params.redirect ?? '/nutrition'}
      wrongPortalHint="This looks like a staff or delivery account — use the staff login instead."
      referredByCode={params.ref}
    />
  );
}
