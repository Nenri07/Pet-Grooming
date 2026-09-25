import type { Metadata } from 'next';
import { isGoogleAuthEnabled } from '@/lib/auth/config';
import { getDemo } from '@/content/demos';
import { RegisterForm } from './RegisterForm';

/**
 * Registration page (server component).
 *
 * Reads the server-only `isGoogleAuthEnabled` flag and passes it down to the
 * client `RegisterForm`, so the "Continue with Google" button is only rendered
 * where Google OAuth is actually configured (Requirement 1.3). Keeping the flag
 * read on the server avoids leaking any Google config into the client bundle.
 *
 * It also consumes the optional `?claim={slug}` param used by the personalized
 * prospect demo pages (Master Spec §17). When the slug matches a seeded demo,
 * the demo's business name is prefilled and a short "claiming your preview"
 * notice is shown. Unknown/absent slugs are simply ignored — nothing else in
 * the flow changes.
 *
 * _Requirements: 1.1, 1.3, 1.4, 21.1, 21.2, 21.3_
 */
export const metadata: Metadata = {
  title: 'Create your account · PawPort',
};

interface RegisterPageProps {
  searchParams: { claim?: string };
}

export default function RegisterPage({ searchParams }: RegisterPageProps) {
  const claimSlug = searchParams?.claim;
  const claimedDemo = claimSlug ? getDemo(claimSlug) : undefined;

  return (
    <RegisterForm
      googleEnabled={isGoogleAuthEnabled}
      claimSlug={claimedDemo?.slug}
      claimBusinessName={claimedDemo?.businessName}
    />
  );
}
