'use client';

import * as React from 'react';
import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

/**
 * LogoutButton — a single, reusable sign-out control.
 *
 * Calls next-auth `signOut({ callbackUrl: '/login' })` so the session is
 * cleared and the visitor lands back on the login screen. Rendered in two
 * shapes via the `variant` prop:
 *
 *  - `icon` (default): a circular 44px icon button, suited to the portal top
 *    bar and the desktop sidebar footer where space is tight.
 *  - `full`: a full-width "Log out" row with icon + label, suited to the mobile
 *    "More" sheet, the Settings Account card, and the marketing avatar area.
 *
 * Colors are DaisyUI theme tokens only, and every shape meets the 44px
 * touch-target minimum.
 */
export interface LogoutButtonProps {
  /** Visual shape. `icon` = circular icon button, `full` = labelled row. */
  variant?: 'icon' | 'full';
  /** Extra classes appended to the button. */
  className?: string;
  /** Override the visible/aria label (defaults to "Log out"). */
  label?: string;
}

export function LogoutButton({
  variant = 'icon',
  className,
  label = 'Log out',
}: LogoutButtonProps) {
  const [pending, setPending] = React.useState(false);

  const handleClick = React.useCallback(() => {
    setPending(true);
    // signOut redirects the browser; no need to reset `pending`.
    void signOut({ callbackUrl: '/login' });
  }, []);

  if (variant === 'full') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label={label}
        className={[
          'flex min-h-[44px] w-full items-center gap-3 rounded-box border border-base-content/10 bg-base-100 px-4 py-3 text-base font-medium text-base-content transition-colors hover:bg-base-200',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          className ?? '',
        ].join(' ')}
      >
        <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={label}
      title={label}
      className={[
        'btn btn-ghost btn-circle min-h-[44px] min-w-[44px] text-base-content',
        className ?? '',
      ].join(' ')}
    >
      <LogOut className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

export default LogoutButton;
