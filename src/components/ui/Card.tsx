import * as React from 'react';

/**
 * Card — responsive surface component with rounded-2xl corners and a soft
 * shadow (shadow-card), matching the PawPort premium aesthetic.
 *
 * Requirements:
 * - 18.5: Cards styled at rounded-2xl with drop shadows no darker than 10%
 *   opacity (the `shadow-card` token defined in tailwind.config.ts).
 */

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Removes default padding when the card wraps custom layout. */
  noPadding?: boolean;
  /** Renders a hover elevation transition for interactive cards. */
  interactive?: boolean;
};

export function Card({
  className,
  children,
  noPadding = false,
  interactive = false,
  ...rest
}: CardProps) {
  return (
    <div
      className={cx(
        'rounded-2xl bg-base-100 shadow-card',
        !noPadding && 'p-4 sm:p-6',
        interactive && 'transition-shadow hover:shadow-lg focus-within:shadow-lg',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('mb-4 flex flex-col gap-1', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cx('text-lg font-semibold text-base-content', className)} {...rest}>
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cx('text-sm text-base-content/60', className)} {...rest}>
      {children}
    </p>
  );
}

export function CardContent({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('mt-4 flex items-center gap-2', className)} {...rest}>
      {children}
    </div>
  );
}

export default Card;
