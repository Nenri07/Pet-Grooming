import * as React from 'react';

/**
 * Container — responsive, centered page wrapper that constrains content width
 * and applies mobile-first horizontal padding.
 *
 * Requirements:
 * - 18.5 / 19.1: Supports the premium responsive layout used across the app,
 *   rendering without horizontal scrolling across mobile (<=767px),
 *   tablet (768-1023px), and desktop (1024px+) breakpoints.
 */

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

type ContainerSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const sizeToMaxWidth: Record<ContainerSize, string> = {
  sm: 'max-w-2xl',
  md: 'max-w-4xl',
  lg: 'max-w-6xl',
  xl: 'max-w-7xl',
  full: 'max-w-none',
};

type ContainerProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Maximum content width. Defaults to `lg`. */
  size?: ContainerSize;
  /** Render as a semantic element other than div (e.g. 'main', 'section'). */
  as?: React.ElementType;
};

export function Container({
  className,
  children,
  size = 'lg',
  as: Component = 'div',
  ...rest
}: ContainerProps) {
  return (
    <Component
      className={cx(
        'mx-auto w-full px-4 sm:px-6 lg:px-8',
        sizeToMaxWidth[size],
        className
      )}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Component>
  );
}

export default Container;
