"use client";

/**
 * Grouped bar comparison — current period vs. prior period, one group per
 * category, currency on the value axis. Built for /reports/profit-loss's
 * income-vs-expenses comparison, but the shape is generic (any set of
 * categories, each with a current/prior cents pair).
 *
 * SUPPLEMENTS the page's own tables — it never replaces them. The report's
 * numbers (including the exact deltas and percentages) stay in the
 * existing Comparison-driven cards; this is a compact visual read of the
 * same two totals, nothing else is computed here.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";

import { formatCents } from "@/lib/format";
import {
  CHART_AXIS_TEXT_COLOR,
  CHART_BAR_RADIUS,
  CHART_BAR_THICKNESS,
  CHART_CURRENT_COLOR,
  CHART_CURSOR_FILL,
  CHART_GRID_COLOR,
  CHART_PRIOR_COLOR,
  CHART_TOOLTIP_BG,
  CHART_TOOLTIP_BORDER,
} from "./chart-colors";

export type PeriodComparisonDatum = {
  category: string;
  currentCents: number;
  priorCents: number;
};

export type PeriodComparisonBarChartProps = {
  data: PeriodComparisonDatum[];
  /** e.g. period.label — "2026" or "Q1 2026". Also the tooltip/legend key. */
  currentLabel: string;
  /** e.g. period.priorLabel — "2025". */
  priorLabel: string;
  /** Full sentence read by a screen reader in place of the SVG — every
   *  number the chart shows, in words. The page composes this from the
   *  same figures it passes as `data`. */
  ariaLabel: string;
};

/** Custom content, not recharts' DefaultTooltipContent — the default
 *  renders through its own `contentStyle`/`itemStyle` objects, which is an
 *  extra surface to keep on-token; a hand-written box using the same
 *  `var(--…)` idiom as the rest of the product is less code to audit, not
 *  more. */
function ComparisonTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: CHART_TOOLTIP_BG,
        border: `1px solid ${CHART_TOOLTIP_BORDER}`,
        borderRadius: "var(--radius)",
        padding: "var(--space-2) var(--space-3)",
        boxShadow: "var(--shadow-overlay)",
        minWidth: 180,
      }}
    >
      <div style={{ color: "var(--ledger-ink-2)", fontSize: "var(--text-1)", marginBottom: "var(--space-1)" }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <span
              aria-hidden
              style={{
                width: "var(--space-2)",
                height: "var(--space-2)",
                borderRadius: "var(--radius-full)",
                background: entry.color,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span style={{ color: "var(--ledger-ink-2)", fontSize: "var(--text-1)" }}>{entry.name}</span>
            <span
              className="tnum-l"
              style={{ color: "var(--ledger-ink)", fontWeight: "var(--weight-semibold)", marginLeft: "auto" }}
            >
              {formatCents(Number(entry.value))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A legend swatch row, hand-built rather than recharts' <Legend> — two
 *  fixed series, known ahead of render, so there is nothing recharts'
 *  payload-driven legend gives us that a plain row of spans doesn't. */
function ComparisonLegend({ currentLabel, priorLabel }: { currentLabel: string; priorLabel: string }) {
  const items = [
    { label: currentLabel, color: CHART_CURRENT_COLOR },
    { label: priorLabel, color: CHART_PRIOR_COLOR },
  ];
  return (
    <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-2)" }}>
      {items.map((item) => (
        <span
          key={item.label}
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-1)", color: "var(--ledger-ink-2)" }}
        >
          <span
            aria-hidden
            style={{
              width: "var(--space-3)",
              height: "var(--space-2)",
              borderRadius: "var(--radius)",
              background: item.color,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function PeriodComparisonBarChart({
  data,
  currentLabel,
  priorLabel,
  ariaLabel,
}: PeriodComparisonBarChartProps) {
  return (
    <div>
      <ComparisonLegend currentLabel={currentLabel} priorLabel={priorLabel} />
      {/* role="img" + aria-label: the SVG itself is not meaningfully
          navigable by a screen reader (recharts draws bars as unlabelled
          <path> nodes), so the accessible experience is this one summary
          sentence plus the page's own table, never the chart alone. */}
      <div role="img" aria-label={ariaLabel} style={{ width: "100%", height: 220 }}>
        {/* ResponsiveContainer needs a parent with a resolved height — the
            fixed 220px above, not a percentage — and reflows on the
            container's own width, so this never forces the page wider
            than its column. */}
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }} barGap={4}>
            <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="category"
              tick={{ fill: CHART_AXIS_TEXT_COLOR, fontSize: "var(--text-1)" }}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value) => formatCents(Number(value))}
              tick={{ fill: CHART_AXIS_TEXT_COLOR, fontSize: "var(--text-1)" }}
              axisLine={false}
              tickLine={false}
              width={76}
            />
            <Tooltip content={ComparisonTooltip} cursor={{ fill: CHART_CURSOR_FILL }} />
            {/* isAnimationActive={false} on every mark, unconditionally —
                honours prefers-reduced-motion by never animating at all
                rather than branching on the media query, matching this
                product's existing restraint (app/design/tokens.css's
                reduced-motion block zeroes durations the same blanket
                way). */}
            <Bar
              dataKey="currentCents"
              name={currentLabel}
              fill={CHART_CURRENT_COLOR}
              radius={CHART_BAR_RADIUS}
              barSize={CHART_BAR_THICKNESS}
              isAnimationActive={false}
            />
            <Bar
              dataKey="priorCents"
              name={priorLabel}
              fill={CHART_PRIOR_COLOR}
              radius={CHART_BAR_RADIUS}
              barSize={CHART_BAR_THICKNESS}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
