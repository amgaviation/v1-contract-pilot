"use client";

/**
 * Horizontal bar per item (client or trip), margin in cents, sign encoded
 * by color — diverging around an implicit zero baseline (dataviz skill's
 * choosing-a-form.md: "above/below a baseline" → diverging bar). Built
 * for /reports/trip-pl's per-client margin rollup, but the shape is
 * generic (any item with an id/label/signed cents figure).
 *
 * SUPPLEMENTS the page's own "By client"/"By trip" tables — every figure
 * drawn here is already printed there. This never computes a margin of
 * its own; it only lays out cents the caller already assembled.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BarShapeProps, TooltipContentProps, YAxisTickContentProps } from "recharts";

import { formatCents } from "@/lib/format";
import {
  CHART_AXIS_TEXT_COLOR,
  CHART_CURSOR_FILL,
  CHART_GRID_COLOR,
  CHART_NEGATIVE_COLOR,
  CHART_POSITIVE_COLOR,
  CHART_TOOLTIP_BG,
  CHART_TOOLTIP_BORDER,
} from "./chart-colors";

export type ItemMarginDatum = {
  id: string;
  label: string;
  marginCents: number;
};

export type ItemMarginBarChartProps = {
  data: ItemMarginDatum[];
  /** Full sentence read by a screen reader in place of the SVG — every
   *  item and its margin, in words. The page composes this from the same
   *  rows it passes as `data`, including a note when the chart shows
   *  fewer items than the underlying table (see the page's own cap). */
  ariaLabel: string;
};

const ROW_HEIGHT = 32; // px per bar, incl. air — a 22px bar plus breathing room
const CHART_VERTICAL_PADDING = 24;
const CATEGORY_AXIS_WIDTH = 132;
const LABEL_MAX_CHARS = 18;

/**
 * Rounds the DATA end of the bar (away from the zero baseline) and keeps
 * it square where the bar meets the baseline — the mark spec's "grows
 * from a single baseline" rule. Bar's own `radius` prop is a single fixed
 * value for the whole series and cannot flip per data point, but a
 * diverging bar's baseline edge DOES flip with sign (a loss's outer edge
 * is on the left, a gain's is on the right), so this needs a custom
 * `shape` renderer rather than the plain `radius` prop the paired-bar
 * chart uses.
 */
function marginBarShape(props: BarShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0, value } = props;
  const numeric = Array.isArray(value) ? value[value.length - 1] : value;
  const positive = (numeric ?? 0) >= 0;
  const radius: [number, number, number, number] = positive ? [0, 3, 3, 0] : [3, 0, 0, 3];
  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      radius={radius}
      fill={positive ? CHART_POSITIVE_COLOR : CHART_NEGATIVE_COLOR}
    />
  );
}

function MarginTooltip({ active, payload }: TooltipContentProps) {
  const entry = payload?.[0];
  if (!active || !entry) return null;
  const cents = Number(entry.value);
  const datum = entry.payload as ItemMarginDatum | undefined;
  return (
    <div
      style={{
        background: CHART_TOOLTIP_BG,
        border: `1px solid ${CHART_TOOLTIP_BORDER}`,
        borderRadius: "var(--radius)",
        padding: "var(--space-2) var(--space-3)",
        boxShadow: "var(--shadow-overlay)",
      }}
    >
      <div style={{ color: "var(--ink-2)", fontSize: "var(--text-1)", marginBottom: "var(--space-1)" }}>
        {datum?.label ?? ""}
      </div>
      <span
        className="tnum"
        style={{
          color: cents < 0 ? CHART_NEGATIVE_COLOR : "var(--ink)",
          fontWeight: "var(--weight-semibold)",
        }}
      >
        {formatCents(cents)}
      </span>
    </div>
  );
}

/** The item label, right-aligned against the value axis, truncated with
 *  an ellipsis and the full name on an SVG <title> (a native hover
 *  tooltip) rather than left to overflow or wrap — a wrapped tick label
 *  would collide with the row above/below it, and CATEGORY_AXIS_WIDTH is
 *  fixed, not measured per label (see marks-and-anatomy.md's "measure
 *  first" rule, which this deliberately does not attempt: the full name
 *  is one hover away, and is never lost — it is still the row header in
 *  the table this chart sits above). */
function CategoryTick(props: YAxisTickContentProps) {
  const { x, y, payload } = props;
  const label = String(payload?.value ?? "");
  const truncated = label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="var(--ink)" fontSize="var(--text-1)">
      {label !== truncated ? <title>{label}</title> : null}
      {truncated}
    </text>
  );
}

export function ItemMarginBarChart({ data, ariaLabel }: ItemMarginBarChartProps) {
  const height = Math.max(data.length * ROW_HEIGHT + CHART_VERTICAL_PADDING, 120);
  return (
    <div>
      {/* Color is reinforcement here, not the only channel — which side of
          the zero ReferenceLine a bar falls on already encodes its sign,
          so this caption is a caveat for a colorblind or grayscale reader,
          not a required legend box (dataviz skill's marks-and-anatomy.md:
          a single series needs no legend box). */}
      <div style={{ fontSize: "var(--text-1)", color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
        <span aria-hidden style={{ color: CHART_POSITIVE_COLOR, fontWeight: "var(--weight-semibold)" }}>
          ●
        </span>{" "}
        Positive margin{"   "}
        <span aria-hidden style={{ color: CHART_NEGATIVE_COLOR, fontWeight: "var(--weight-semibold)" }}>
          ●
        </span>{" "}
        Negative margin
      </div>
      <div role="img" aria-label={ariaLabel} style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={CHART_GRID_COLOR} horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(value) => formatCents(Number(value))}
              tick={{ fill: CHART_AXIS_TEXT_COLOR, fontSize: "var(--text-1)" }}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={CATEGORY_AXIS_WIDTH}
              tick={CategoryTick}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine x={0} stroke="var(--ink-3)" />
            <Tooltip content={MarginTooltip} cursor={{ fill: CHART_CURSOR_FILL }} />
            <Bar dataKey="marginCents" shape={marginBarShape} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
