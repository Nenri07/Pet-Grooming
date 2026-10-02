'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Input primitive themed with DaisyUI OKLCH tokens. Forwards its
 * ref to the underlying `<input>` and spreads all native props, so it drops
 * into forms (including react-hook-form `register`) the same way a native
 * input would.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex min-h-[44px] w-full rounded-btn border border-base-content/10 bg-base-100 px-3 py-2 text-sm text-base-content ring-offset-base-100 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export { Input };
