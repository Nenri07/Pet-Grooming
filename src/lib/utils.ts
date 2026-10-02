import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind/DaisyUI class names, resolving conflicts in favor of the
 * last-specified utility. Used by the shadcn-style UI primitives in
 * `src/components/ui/*` so callers can override defaults via `className`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
