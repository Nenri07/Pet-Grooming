import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { getMonthlyAnalytics, getAnalyticsSeries } from '@/actions/analytics';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { AnalyticsCharts } from '@/components/portal/AnalyticsCharts';

/**
 * Analytics dashboard page (server component).
 *
 * Authenticates the groomer, loads the current- and previous-month metrics via
 * the `getMonthlyAnalytics` server action (scoped to the authenticated
 * groomer), and renders three headline metric cards:
 *   - Total bookings (integer)
 *   - Total revenue (currency, 2 decimal places)
 *   - No-show rate (percentage, 1 decimal place)
 *
 * Bookings and revenue show the previous-month delta (e.g. "+3 vs last month");
 * no-show rate has no comparison per Requirement 16.2. When there is no data
 * for the current month, all metrics render as zeros and the comparison deltas
 * are omitted (Requirement 16.3).
 *
 * _Requirements: 16.1, 16.2, 16.3_
 */

// Metrics reflect live appointment/transaction data; always render fresh.
export const dynamic = 'force-dynamic';

/** Format an integer count. */
function formatCount(value: number): string {
  return String(value);
}

/** Format a monetary amount as USD with 2 decimal places. */
function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Format a percentage with 1 decimal place. */
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** A signed delta label like "+3" or "-1.50", or "0" when unchanged. */
function formatDelta(value: number, kind: 'count' | 'currency'): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  const body =
    kind === 'currency' ? magnitude.toFixed(2) : String(magnitude);
  return `${sign}${body}`;
}

function MetricCard({
  title,
  value,
  delta,
}: {
  title: string;
  value: string;
  /** Optional comparison line; omitted for no-show rate and zero-data. */
  delta?: string;
}) {
  const isPositive = delta?.startsWith('+');
  const isNegative = delta?.startsWith('-');

  return (
    <Card>
      <CardHeader className="mb-2">
        <CardTitle className="text-sm font-medium text-base-content/60">
          {title}
        </CardTitle>
      </CardHeader>
      <p className="text-3xl font-semibold text-base-content">{value}</p>
      {delta !== undefined && (
        <p
          className={
            isPositive
              ? 'mt-1 text-sm text-success'
              : isNegative
                ? 'mt-1 text-sm text-error'
                : 'mt-1 text-sm text-base-content/60'
          }
        >
          {delta} vs last month
        </p>
      )}
    </Card>
  );
}

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);

  // Portal routes require an authenticated groomer (Requirement 1.5). The
  // middleware already gates this, but we guard here so the query never runs
  // without a groomer id.
  if (!session?.user?.id) {
    redirect('/login');
  }

  const [result, seriesResult] = await Promise.all([
    getMonthlyAnalytics(),
    getAnalyticsSeries(),
  ]);

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-6 text-2xl font-semibold text-base-content">
          Analytics
        </h1>
        <div role="alert" className="alert alert-error">
          <span>{result.error}</span>
        </div>
      </div>
    );
  }

  const { current, diff, hasData } = result;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-base-content">Analytics</h1>
        <p className="text-sm text-base-content/60">This month at a glance</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          title="Total bookings"
          value={formatCount(current.bookings)}
          delta={hasData ? formatDelta(diff.bookings, 'count') : undefined}
        />
        <MetricCard
          title="Total revenue"
          value={formatCurrency(current.revenue)}
          delta={hasData ? formatDelta(diff.revenue, 'currency') : undefined}
        />
        <MetricCard
          title="No-show rate"
          value={formatPercent(current.noShowRate)}
        />
      </div>

      <div className="mt-6">
        {seriesResult.ok ? (
          <AnalyticsCharts series={seriesResult.series} />
        ) : (
          <div role="alert" className="alert alert-error">
            <span>{seriesResult.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
