import * as React from 'react';

/**
 * Card — responsive surface component with rounded-xl corners and a hairline
 * border, matching the Linear/Vercel/Stripe aesthetic.
 *
 * Requirements:
 * - 18.5: Cards styled with borders and minimal shadows.
 */

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Removes default padding when the card wraps custom layout. */
  noPadding?: boolean;
  /** Renders a hover border transition for interactive cards. */
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
        'rounded-xl bg-base-100 border border-base-300',
        !noPadding && 'p-5',
        interactive && 'transition-colors duration-150 hover:border-base-content/20',
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
