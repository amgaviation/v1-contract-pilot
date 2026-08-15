import type { ReactNode } from "react";

/**
 * LEDGER's PageShell successor (docs/design/LEDGER.md, Phase 2 — "the
 * shell"). This is the component every Phase-3+ screen composes its header
 * through, so the header treatment Overview hand-rolled as the visual
 * contract (Phase 1) has exactly one implementation instead of drifting a
 * little on each new screen that copies it by eye.
 *
 * Same API as the INSTRUMENT PageShell it succeeds (app/(app)/page-shell.tsx
 * — title, subtitle?, action?, children) so a migrated screen swaps its
 * import and reshapes nothing at the call site. That predecessor is not
 * touched by this migration: it keeps serving every screen that hasn't
 * moved yet, and is deleted in Phase 6 once none remain.
 *
 * Server component composing no state or effects, so a page built on this
 * stays a server component and keeps querying Supabase directly — the
 * property components/ledger/index.tsx's own header calls out as the whole
 * reason the primitive layer holds no client-only pieces.
 */
export function LPageShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    // font-ledger text-body text-ink on the root: the subtree's exit from
    // INSTRUMENT type. The shell around this slot still paints INSTRUMENT's
    // canvas until the canvas swap lands later in Phase 2 — this wrapper is
    // what lets a migrated screen's own cards read as Ledger regardless of
    // what's behind them, exactly as Overview's hand-rolled wrapper did.
    <div className="flex flex-col gap-5 font-ledger text-body text-ink">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-bold tracking-tight">{title}</h1>
          {subtitle ? <p className="text-body-s text-ink-3">{subtitle}</p> : null}
        </div>
        {/* Wide screens: action sits beside the title. Narrow: it stacks
            beneath, full-width-ready — the same sm breakpoint the outer
            row itself flips on. */}
        {action ? <div className="flex shrink-0 gap-3">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}
