'use client';

import * as React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  type TooltipContentProps,
} from 'recharts';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import type { MonthlySeriesPoint } from '@/lib/analytics/metrics';

/**
 * AnalyticsCharts — theme-aware recharts visualizations for the 12-month series.
 *
 * Two charts:
 *  1. Bookings + revenue combo (ComposedChart): revenue as bars, bookings as a
 *     line on a second axis.
 *  2. No-show rate trend (AreaChart).
 *
 * THEME WIRING: every color is a CSS color string that references a theme token
 * via `oklch(var(--token))`. The tokens in theme.css are OKLCH triples
 * ("L C H"), and `oklch(var(--p))` resolves to a valid color the browser
 * recomputes whenever `data-theme` changes on <html>. So the charts recolor
 * live with the selected theme, no JS re-read needed:
 *   - revenue bars  → --p (primary)
 *   - bookings line → --a (accent)
 *   - no-show area  → --er (error)
 *   - grid / axes   → --bc (base-content) at low opacity
 *
 * Reduced motion: recharts animations are disabled when the user prefers
 * reduced motion (`isAnimationActive={false}`).
 *
 * _Requirements: 16.1, 16.2, 16.3, 19.x (reduced motion)._
 */

/** Theme token colors as CSS `oklch(var(--token))` strings. */
const COLOR = {
  primary: 'oklch(var(--p))',
  accent: 'oklch(var(--a))',
  error: 'oklch(var(--er))',
  gridLine: 'oklch(var(--bc) / 0.12)',
  axisText: 'oklch(var(--bc) / 0.6)',
  surface: 'oklch(var(--b1))',
  surfaceBorder: 'oklch(var(--bc) / 0.12)',
  baseContent: 'oklch(var(--bc))',
} as const;

/** True when the user has requested reduced motion. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** USD formatter for tooltips/axes. */
function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Shared tooltip styled with base tokens so it matches the active theme. */
function ChartTooltip({
  active,
  payload,
  label,
}: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-box border p-3 text-sm shadow-card"
      style={{
        backgroundColor: COLOR.surface,
        borderColor: COLOR.surfaceBorder,
        color: COLOR.baseContent,
      }}
    >
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((entry) => {
        const name = String(entry.name ?? '');
        const raw = typeof entry.value === 'number' ? entry.value : 0;
        const formatted =
          name === 'Revenue'
            ? usd(raw)
            : name === 'No-show rate'
              ? `${raw.toFixed(1)}%`
              : String(raw);
        return (
          <p key={name} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: entry.color ?? COLOR.baseContent }}
            />
            <span className="opacity-70">{name}:</span>
            <span className="font-medium">{formatted}</span>
          </p>
        );
      })}
    </div>
  );
}

export function AnalyticsCharts({ series }: { series: MonthlySeriesPoint[] }) {
  const reducedMotion = usePrefersReducedMotion();
  const animate = !reducedMotion;

  // Empty-data guard: if every month is zero across all metrics, show a
  // friendly message instead of flat, meaningless charts.
  const hasAny = series.some(
    (p) => p.bookings > 0 || p.revenue > 0 || p.noShowRate > 0
  );

  if (!hasAny) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Trends</CardTitle>
        </CardHeader>
        <p className="text-sm text-base-content/60">
          No booking or revenue history yet. Once you take bookings, your
          12-month trends will appear here.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Bookings + revenue combo (spans 2/3 on large screens). */}
      <Card className="lg:col-span-2">
        <CardHeader className="mb-2">
          <CardTitle className="text-base">Bookings & revenue</CardTitle>
          <p className="text-sm text-base-content/60">Last 12 months</p>
        </CardHeader>
        <figure aria-label="Bookings and revenue over the last 12 months">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={series}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke={COLOR.gridLine} vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={COLOR.axisText}
                  tick={{ fill: COLOR.axisText, fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: COLOR.gridLine }}
                />
                <YAxis
                  yAxisId="revenue"
                  stroke={COLOR.axisText}
                  tick={{ fill: COLOR.axisText, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(v: number) => `$${v}`}
                />
                <YAxis
                  yAxisId="bookings"
                  orientation="right"
                  stroke={COLOR.axisText}
                  tick={{ fill: COLOR.axisText, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  allowDecimals={false}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: COLOR.gridLine }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: COLOR.axisText }}
                />
                <Bar
                  yAxisId="revenue"
                  dataKey="revenue"
                  name="Revenue"
                  fill={COLOR.primary}
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={animate}
                  maxBarSize={36}
                />
                <Line
                  yAxisId="bookings"
                  type="monotone"
                  dataKey="bookings"
                  name="Bookings"
                  stroke={COLOR.accent}
                  strokeWidth={2}
                  dot={{ r: 3, fill: COLOR.accent }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={animate}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="sr-only">
            Monthly revenue shown as bars and monthly booking counts shown as a
            line, for the last twelve months.
          </figcaption>
        </figure>
      </Card>

      {/* No-show rate trend. */}
      <Card>
        <CardHeader className="mb-2">
          <CardTitle className="text-base">No-show rate</CardTitle>
          <p className="text-sm text-base-content/60">Last 12 months</p>
        </CardHeader>
        <figure aria-label="No-show rate over the last 12 months">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={series}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="noShowFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR.error} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={COLOR.error} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={COLOR.gridLine} vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={COLOR.axisText}
                  tick={{ fill: COLOR.axisText, fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: COLOR.gridLine }}
                />
                <YAxis
                  stroke={COLOR.axisText}
                  tick={{ fill: COLOR.axisText, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: COLOR.gridLine }}
                />
                <Area
                  type="monotone"
                  dataKey="noShowRate"
                  name="No-show rate"
                  stroke={COLOR.error}
                  strokeWidth={2}
                  fill="url(#noShowFill)"
                  isAnimationActive={animate}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="sr-only">
            Monthly no-show rate as a percentage, for the last twelve months.
          </figcaption>
        </figure>
      </Card>
    </div>
  );
}

export default AnalyticsCharts;
