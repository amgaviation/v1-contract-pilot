import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/ledger/cn";

/**
 * LEDGER primitives — the successor component layer (docs/design/LEDGER.md).
 *
 * Shape rules, decided once here so 70 screens don't re-decide them:
 *
 *   - Server-component friendly: nothing in this file uses state or
 *     effects, so pages composing these stay server components and keep
 *     querying Supabase directly — the property the whole app is built on.
 *   - Styling is Tailwind utilities against ledger.css's tokens ONLY.
 *     No i-* classes, no var() in TSX, no literal colors — the theme file
 *     wiped Tailwind's stock palette, so a color that isn't Ledger's
 *     simply does not exist as a utility.
 *   - Figures: anything numeric a pilot cross-checks (money, hours, dates
 *     in tables) carries `tnum-l`. Components that exist to show figures
 *     (Stat, Money) apply it themselves.
 *   - Interactive primitives that need browser behavior (dialogs, selects)
 *     are NOT re-invented here: the native-element approach that
 *     components/ds proved out survives the migration — Ledger reskins it
 *     (see LDialog in dialog.tsx when a migrated screen first needs one).
 */

/* ── Button ────────────────────────────────────────────────────────── */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-control font-ledger font-medium " +
    "transition-colors duration-100 select-none " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
    "disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        /* Primary is ACCENT here, unlike INSTRUMENT's ink button — in the
           fintech register the one filled-indigo action per view is the
           signature move, and restraint comes from using it once. */
        primary: "bg-accent text-accent-ink hover:opacity-92",
        outline: "border border-hair-strong bg-card text-ink hover:bg-sunk",
        quiet: "text-ink-2 hover:bg-sunk hover:text-ink",
        danger: "bg-crit text-white hover:opacity-92",
      },
      size: {
        sm: "h-8 px-3 text-body-s",
        md: "h-9 px-4 text-body",
        lg: "h-11 px-5 text-body",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface LButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const LButton = React.forwardRef<HTMLButtonElement, LButtonProps>(
  function LButton({ className, variant, size, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);

/** The same skin on an anchor, for Next <Link> composition without a
 *  Slot dependency: <LLinkButton asChild={false}> wraps its own <a>. */
export function lButtonClass(opts?: VariantProps<typeof buttonVariants> & { className?: string }) {
  return cn(buttonVariants({ variant: opts?.variant, size: opts?.size }), opts?.className);
}

/* ── Card ──────────────────────────────────────────────────────────── */

export const LCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function LCard({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-card border border-hair bg-card p-5 shadow-card",
        className
      )}
      {...props}
    />
  );
});

/* ── Pill (status) ─────────────────────────────────────────────────── */

const pillVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-sunk text-ink-2",
        accent: "bg-accent-soft text-accent",
        good: "bg-good-soft text-good",
        warn: "bg-warn-soft text-warn",
        crit: "bg-crit-soft text-crit",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface LPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {}

export function LPill({ className, tone, ...props }: LPillProps) {
  return <span className={cn(pillVariants({ tone }), className)} {...props} />;
}

/* ── Stat (the KPI shape) ──────────────────────────────────────────── */

/**
 * One number a pilot glances at. The figure is the component's whole
 * reason to exist, so it sets the size and the tabular numerals itself —
 * a Stat whose figure could render proportional digits would be a bug.
 */
export function LStat({
  label,
  figure,
  sub,
  tone,
  className,
}: {
  label: React.ReactNode;
  figure: React.ReactNode;
  sub?: React.ReactNode;
  /** Colors the FIGURE only. Reserved for money states (overdue, paid). */
  tone?: "good" | "warn" | "crit";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="text-caption font-semibold text-ink-3">{label}</div>
      <div
        className={cn(
          "tnum-l text-figure font-bold tracking-tight",
          tone === "good" && "text-good",
          tone === "warn" && "text-warn",
          tone === "crit" && "text-crit"
        )}
      >
        {figure}
      </div>
      {sub !== undefined ? (
        <div className="text-caption text-ink-3">{sub}</div>
      ) : null}
    </div>
  );
}

/* ── Alert (callout) ───────────────────────────────────────────────── */

const alertVariants = cva("rounded-card border px-4 py-3 text-body-s", {
  variants: {
    tone: {
      neutral: "border-hair bg-sunk text-ink-2",
      accent: "border-accent-soft bg-accent-soft text-ink",
      warn: "border-warn-soft bg-warn-soft text-ink",
      crit: "border-crit-soft bg-crit-soft text-ink",
      good: "border-good-soft bg-good-soft text-ink",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface LAlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

/** role="alert" stays the CALLER's decision: most Ledger alerts render on
 *  page load (server component), where an alert role would make a screen
 *  reader announce static text as urgent. Pass it only for live errors. */
export function LAlert({ className, tone, ...props }: LAlertProps) {
  return <div className={cn(alertVariants({ tone }), className)} {...props} />;
}

/* ── Empty state ───────────────────────────────────────────────────── */

/**
 * The empty-state shape, ported from components/ui/empty-state.tsx for the
 * first Ledger screen that needs one (Overview). Same split as that file:
 * the SHAPE lives here, the WORDS stay at the call site — no default title,
 * body or action, so a call site cannot ship "No records." and call it
 * done. A failed read is still not an empty state; call sites keep their
 * own LAlert for that branch and reach this component only once a read has
 * succeeded.
 */
export function LEmpty({
  title,
  children,
  action,
  secondaryAction,
  as = "h3",
  className,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  /** Defaults to h3, right inside a card under the page's h1. A screen
   *  whose empty state IS the panel heading passes "h2". */
  as?: "h2" | "h3";
  className?: string;
}) {
  const Heading = as;
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-3 py-10 text-center",
        className
      )}
    >
      <Heading className="text-h3 font-semibold text-ink">{title}</Heading>
      <p className="max-w-md text-body-s text-ink-2">{children}</p>
      {action || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

/* ── Rows (the list-line shape) ────────────────────────────────────── */

/**
 * The proposal's signature list: hairline-separated rows inside a card,
 * label left, figures right. divide-y on the parent instead of borders on
 * children means the first/last row needs no special-casing.
 */
export function LRows({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("divide-y divide-hair", className)} {...props} />;
}

export function LRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5",
        className
      )}
      {...props}
    />
  );
}

/* ── Separator ─────────────────────────────────────────────────────── */

export function LSeparator({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-hair my-4", className)} />;
}

/* ── Table ─────────────────────────────────────────────────────────── */

/**
 * Same scroll-container discipline components/ds/surface.tsx proved: the
 * wrapper owns overflow-x so a wide table scrolls itself, never the page.
 */
export function LTable({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-body-s", className)}>
        {children}
      </table>
    </div>
  );
}

export function LTh({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        "border-b border-hair px-3 py-2 text-left text-caption font-semibold text-ink-3 first:pl-0 last:pr-0",
        numeric && "text-right",
        className
      )}
      {...props}
    />
  );
}

export function LTd({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-hair px-3 py-2.5 align-baseline text-ink first:pl-0 last:pr-0",
        numeric && "tnum-l text-right",
        className
      )}
      {...props}
    />
  );
}
