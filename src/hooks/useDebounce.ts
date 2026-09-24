/**
 * useDebounce — return a debounced copy of a rapidly-changing value.
 *
 * The returned value only updates after `delay` milliseconds have elapsed
 * without `value` changing again. This is used by the client search input so
 * the `searchClients` server action is only called after the groomer stops
 * typing (default 300ms), satisfying the "within 300 milliseconds of the last
 * keystroke" debounce contract.
 *
 * _Requirements: 10.2_
 *
 * @param value The value to debounce (typically the live input string).
 * @param delay Debounce delay in milliseconds. Defaults to 300ms.
 * @returns The most recent `value` that has remained stable for `delay` ms.
 */
import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebounce;
