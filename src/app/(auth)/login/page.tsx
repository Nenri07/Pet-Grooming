import type { Metadata } from 'next';
import { isGoogleAuthEnabled } from '@/lib/auth/config';
import { LoginForm } from './LoginForm';

/**
 * Login page (server component).
 *
 * Reads the server-only `isGoogleAuthEnabled` flag and hands it to the client
 * `LoginForm` so the "Continue with Google" button only appears where Google
 * OAuth is configured (Requirement 1.3).
 *
 * _Requirements: 1.2, 1.3, 1.7, 21.1, 21.2, 21.3_
 */
export const metadata: Metadata = {
  title: 'Log in · PawPort',
};

export default function LoginPage() {
  return <LoginForm googleEnabled={isGoogleAuthEnabled} />;
}
