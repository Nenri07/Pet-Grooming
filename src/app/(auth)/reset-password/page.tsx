import type { Metadata } from 'next';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Choose a new password · Pawxis',
  robots: { index: false, follow: false },
  // The URL carries a one-time token; never send it as a referrer to other sites.
  referrer: 'no-referrer',
};

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string | string[] };
}) {
  const raw = searchParams.token;
  const token = typeof raw === 'string' ? raw : '';
  return <ResetPasswordForm token={token} />;
}
