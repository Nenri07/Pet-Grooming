'use client';

import { Toaster } from 'sonner';

/**
 * ToastProvider renders the sonner Toaster used for app-wide notifications.
 *
 * Behavior (Requirements 19.5, 19.6):
 * - Success and informational toasts auto-dismiss after 5 seconds.
 * - Error toasts persist until manually dismissed. Errors are raised with
 *   `toast.error(msg, { duration: Infinity })` at call sites so they override
 *   the default 5s duration set here.
 * - At most 3 toasts are visible at once; additional toasts queue until a
 *   visible one is dismissed or expires (visibleToasts={3}).
 *
 * Cards/toasts use rounded-2xl styling with a soft shadow to match the theme.
 */
export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      duration={5000}
      visibleToasts={3}
      richColors
      toastOptions={{
        classNames: {
          toast: 'rounded-2xl shadow-card',
          error: 'bg-error text-error-content',
        },
      }}
    />
  );
}
