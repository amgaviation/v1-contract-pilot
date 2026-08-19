import { LAlert } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import { requireAccount } from "@/lib/supabase/account";
import { BRAND, CURRENCY_DISCLAIMER } from "@/lib/brand";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";
import { evaluateCurrency } from "@/lib/currency";
import { loadCurrencyInput } from "@/lib/currency/read";
import type { CurrencyResult } from "@/lib/currency/types";
import CurrencyCard from "./currency-card";
import RecomputeButton from "./recompute-button";
import { formatCurrencyDate, isNextControlFlowError, utcDateOf } from "./presentation";

export const metadata = { title: "Currency" };

/**
 * The currency board — the first (and only) screen that renders the
 * currency engine's output. Three states, none of which is an empty card
 * grid:
 *
 *   FLAG OFF   an honest "not enabled on this deployment" notice. The
 *              engine ships dark (lib/currency/gate.ts) until its
 *              reviews are signed off; this page must render that fact,
 *              never crash on read.ts's assertion, and never imply the
 *              feature is merely loading.
 *   READ FAILED a refuse state: "we could not find out" — which is a
 *              different fact from "you have nothing to worry about" and
 *              must never render like it (lib/supabase/rows.ts, THE
 *              RULE). No cards render at all, because four honest cards
 *              next to one silently missing one reads as "fine".
 *   LOADED     the five-card board, computed fresh from the pilot's own
 *              logbook on every render, with the counsel-reviewed
 *              disclaimer ABOVE the cards (docs/CURRENCY-SPEC.md §7 — it
 *              travels with the data, never a footnote) and the as-of
 *              date prominent, because staleness is safety-relevant.
 *
 * All data access goes through lib/currency/read.ts — the engine's only
 * I/O module — and every sentence of currency prose comes from the
 * engine's own describe/notes/assumptions strings, rendered verbatim.
 */
export default async function CurrencyPage() {
  await requireAccount("/currency");

  if (!isCurrencyEngineEnabled()) {
    return (
      <LPageShell
        title="Currency"
        subtitle="Estimated FAA currency, computed from your own logbook entries"
      >
        <LAlert tone="neutral" className="flex items-start gap-2">
          <InfoIcon className="mt-0.5 shrink-0 text-ink-3" />
          <span className="flex flex-col gap-1">
            <span className="font-medium text-ink">
              Currency isn&rsquo;t enabled on this deployment.
            </span>
            <span className="text-body-s">
              The currency board ships dark behind a deployment flag until its regulatory
              spec review and the counsel review of its disclaimer are signed off. Until
              the flag is set on this deployment, nothing here computes, reads, or shows
              currency. This notice is the whole feature. There is no in-app switch.
            </span>
          </span>
        </LAlert>
      </LPageShell>
    );
  }

  // The server's UTC calendar date — the one as-of convention this board
  // uses everywhere (see utcDateOf's comment for why not the client's
  // local date). Every window on every card below is evaluated against
  // this exact date, and the recompute action derives its own asOf the
  // same way.
  const asOf = utcDateOf(new Date());

  let results: CurrencyResult[] | null = null;
  try {
    const input = await loadCurrencyInput({ asOf, intendedTail: null });
    results = evaluateCurrency(input);
  } catch (e) {
    // requireAccount inside loadCurrencyInput redirects by throwing —
    // that must propagate, not render as a failure.
    if (isNextControlFlowError(e)) throw e;
    results = null;
  }

  // A currency board must NEVER render an empty card grid — five absent
  // cards read as "nothing to worry about", which is the one lie this
  // screen exists to never tell. evaluateCurrency contractually returns
  // exactly five results; if that ever stops being true, refuse loudly
  // rather than render the reassuring blank.
  if (results !== null && results.length === 0) {
    results = null;
  }

  if (results === null) {
    return (
      <LPageShell
        title="Currency"
        subtitle="Estimated FAA currency, computed from your own logbook entries"
      >
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span className="flex flex-col gap-1">
            <span className="font-medium text-ink">
              Couldn&rsquo;t read your logbook, so no currency estimates are shown.
            </span>
            <span className="text-body-s">
              This is not a statement that you are current, and not a statement that you
              are not. It means this screen could not find out. Reload to try again; if
              it keeps failing, email {BRAND.supportEmail}. Your logbook itself is unaffected.
            </span>
          </span>
        </LAlert>
      </LPageShell>
    );
  }

  return (
    <LPageShell
      title="Currency"
      subtitle={`Estimated from your logbook as of ${
        formatCurrencyDate(asOf) ?? asOf
      } (UTC), computed fresh on this page load`}
      action={<RecomputeButton />}
    >
      {/* COUNSEL-REVIEWED COPY, verbatim from lib/brand.ts — never
          paraphrased, never separated from the data below it, rendered
          above the cards per docs/CURRENCY-SPEC.md §7. The same string
          travels inside every snapshot the recompute action writes
          (currency_snapshots.limitations, NOT NULL). */}
      <LAlert tone="accent" className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 shrink-0 text-accent" />
        <span>{CURRENCY_DISCLAIMER}</span>
      </LAlert>

      <div className="flex flex-col gap-1">
        <p className="text-body-s font-medium text-ink">
          {`As of ${formatCurrencyDate(asOf) ?? asOf}`}
        </p>
        <p className="text-caption text-ink-3">
          Every window below is evaluated against the UTC calendar date above. Each card
          states its own arithmetic and the entries it counted. The estimate is only as
          good as the logbook it reads.
        </p>
      </div>

      {/* evaluateCurrency always returns exactly five results, one per
          currency type, in vocabulary order — an absent card would read
          as "fine", so the engine never omits one and this page renders
          whatever it returns, unfiltered. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {results.map((result) => (
          <CurrencyCard key={result.currencyType} result={result} />
        ))}
      </div>
    </LPageShell>
  );
}

/* ── Inline icons ──────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. aria-hidden, stroke="currentColor" so each inherits its
 * caller's tone utility. WarningIcon matches invoices/page.tsx's own
 * shape; InfoIcon is this screen's own, same construction. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4" />
      <circle cx="8" cy="5" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
