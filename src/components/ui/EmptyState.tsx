import * as React from 'react';

/**
 * EmptyState — shown when a list or view contains no data.
 *
 * Requirements:
 * - 19.4: IF a list or view contains no data, display an empty state that
 *   includes a label identifying the empty collection AND a message suggesting
 *   a next action the user can take.
 *
 * `title` serves as the label identifying the empty collection (e.g.
 * "No clients yet"). `description` conveys the suggested next action (e.g.
 * "Add your first client to get started."). Both are required by the contract
 * so every empty state satisfies Req 19.4.
 */

interface EmptyStateAction {
  /** Button label. */
  label: string;
  /** Click handler (for client components). */
  onClick?: () => void;
  /** Optional href to render an anchor instead of a button. */
  href?: string;
}

interface EmptyStateProps {
  /** Optional icon element (e.g. a lucide-react icon) shown above the title. */
  icon?: React.ReactNode;
  /** Label identifying the empty collection (Req 19.4). Required. */
  title: string;
  /** Message suggesting a next action the user can take (Req 19.4). Required. */
  description: string;
  /** Optional call-to-action for the suggested next step. */
  action?: EmptyStateAction;
  className?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center rounded-2xl bg-base-100 px-6 py-12 text-center shadow-card',
        className
      )}
      role="status"
    >
      {icon && (
        <div className="mb-4 text-base-content/40" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-base-content">{title}</h3>
      <p className="mt-1 max-w-sm text-base-content/60">{description}</p>
      {action &&
        (action.href ? (
          <a
            href={action.href}
            className="btn btn-primary mt-6 min-h-[44px]"
            onClick={action.onClick}
          >
            {action.label}
          </a>
        ) : (
          <button
            type="button"
            className="btn btn-primary mt-6 min-h-[44px]"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}

export default EmptyState;
