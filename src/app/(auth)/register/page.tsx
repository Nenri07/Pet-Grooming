import type { Metadata } from 'next';
import { isGoogleAuthEnabled } from '@/lib/auth/config';
import { RegisterForm } from './RegisterForm';

/**
 * Registration page (server component).
 *
 * Reads the server-only `isGoogleAuthEnabled` flag and passes it down to the
 * client `RegisterForm`, so the "Continue with Google" button is only rendered
 * where Google OAuth is actually configured (Requirement 1.3). Keeping the flag
 * read on the server avoids leaking any Google config into the client bundle.
 *
 * _Requirements: 1.1, 1.3, 1.4, 21.1, 21.2, 21.3_
 */
export const metadata: Metadata = {
  title: 'Create your account · PawPort',
};

export default function RegisterPage() {
  return <RegisterForm googleEnabled={isGoogleAuthEnabled} />;
}
