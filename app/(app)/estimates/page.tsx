import NextLink from "next/link";
import {
  LAlert,
  LCard,
  LEmpty,
  LPill,
  LTable,
  LTd,
  LTh,
  lButtonClass,
} from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { rowsOf, type DbErrorLike } from "@/lib/supabase/rows";
import {
  ESTIMATE_STATUS_BADGE,
  ESTIMATE_STATUS_FALLBACK,
  type EstimateBadge,
  type EstimateStatus,
} from "./estimate-lib";

export const metadata = { title: "Estimates" };

type EstimateListRow = {
  id: string;
  client_id: string;
  estimate_number: string | null;
  status: EstimateStatus;
  issued_on: string | null;
  valid_until: string | null;
  converted_invoice_id: string | null;
};

type TotalsRow = { estimate_id: string; total_cents: number };

/**
 * Supabase's Data API caps rows and truncates SILENTLY (200, not an
 * error) — same guard, same reasoning, as the invoices list.
 */
const LIST_LIMIT = 1000;

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Declined" },
  { key: "expired", label: "Expired" },
  { key: "all", label: "All" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

// The status/badge vocabulary is shared with the detail screen
// ([id]/page.tsx), which carries the identical mapping under the identical
// comment — duplicated rather than imported, same posture estimate-lib.ts's
// own header documents for cross-agent-surface helpers this session
// (estimate-lib.ts itself is a read-only logic file for this pass). A
// straight, restrained dictionary, the same one Overview's ladder uses:
// red→crit, amber→warn, green→good, gray→neutral, blue→accent.
function estimateBadgeTone(
  color: EstimateBadge["color"]
): "crit" | "warn" | "good" | "neutral" | "accent" {
  switch (color) {
    case "red":
      return "crit";
    case "amber":
      return "warn";
    case "green":
      return "good";
    case "blue":
      return "accent";
    default:
      return "neutral";
  }
}

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireEntitlement("estimates", "/estimates");
  const { show } = await searchParams;
  // "Open" (drafts still being written plus sent quotes awaiting an
  // answer) is the default view: a pilot opens this screen to find out
  // which quotes are still in play, not to reread ones already answered.
  const filter: FilterKey =
    (FILTERS.find((f) => f.key === show)?.key as FilterKey) ?? "open";

  const supabase = await createClient();
  // estimate_totals is the ONE source for an estimate's money and
  // estimates_expired the one source for past-valid-until-ness — read the
  // views rather than recomputing either here (their own comments in the
  // Phase 10 migration say exactly this). Totals are fetched AFTER these,
  // keyed to the rows actually shown — see the chunked read below.
  const [estimatesRes, expiredRes, clientsRes] = await Promise.all([
    supabase
      .from("estimates")
      .select(
        "id, client_id, estimate_number, status, issued_on, valid_until, converted_invoice_id"
      )
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT),
    supabase
      .from("estimates_expired")
      .select("estimate_id, days_expired")
      .limit(LIST_LIMIT),
    supabase.from("clients").select("id, name").limit(LIST_LIMIT),
  ]);

  const estimatesResult = rowsOf<EstimateListRow>(
    estimatesRes as { data: EstimateListRow[] | null; error: DbErrorLike | null }
  );
  const expiredResult = rowsOf<{ estimate_id: string; days_expired: number }>(
    expiredRes as {
      data: { estimate_id: string; days_expired: number }[] | null;
      error: DbErrorLike | null;
    }
  );
  const clientsResult = rowsOf<{ id: string; name: string }>(
    clientsRes as { data: { id: string; name: string }[] | null; error: DbErrorLike | null }
  );

  const estimates = estimatesResult.ok ? estimatesResult.rows : [];
  const expiredRows = expiredResult.ok ? expiredResult.rows : [];
  const expiredIds = new Set(expiredRows.map((e) => e.estimate_id));
  const clientNames = new Map(
    (clientsResult.ok ? clientsResult.rows : []).map((c) => [c.id, c.name])
  );

  const truncated = estimates.length === LIST_LIMIT;

  const awaitingCount = estimates.filter((e) => e.status === "sent").length;

  const visible = estimates.filter((estimate) => {
    switch (filter) {
      case "open":
        return estimate.status === "draft" || estimate.status === "sent";
      case "accepted":
        return estimate.status === "accepted";
      case "declined":
        return estimate.status === "declined";
      case "expired":
        return expiredIds.has(estimate.id);
      default:
        return true;
    }
  });

  // REVIEW FINDING (list totals join breaks past 1000): this used to be an
  // INDEPENDENT `estimate_totals` read capped at the same 1000 rows — but
  // unordered, so past 1000 estimates the two result sets diverged and
  // every unmatched row rendered a healthy gray $0.00. Totals are now
  // keyed to the ids actually shown with `.in(...)`, so a totals row can
  // only be missing if something is genuinely broken — and then it gets
  // the refusal treatment below, never $0.00 (the client statement's rule:
  // a missing invoice_totals row is "we could not find out").
  //
  // Chunked for the same URL-length reason as the import screens'
  // FINGERPRINT_LOOKUP_CHUNK: supabase-js emits `.in()` as a GET query
  // string, and 1000 uuids is ~37 KB of URL — past a conservative 8 KB
  // header budget. 100 uuids is ~3.7 KB, comfortably inside it.
  const TOTALS_IN_CHUNK = 100;
  const visibleIds = visible.map((estimate) => estimate.id);
  const totalsByEstimate = new Map<string, number>();
  let totalsError: DbErrorLike | null = null;
  for (let i = 0; i < visibleIds.length; i += TOTALS_IN_CHUNK) {
    const chunkResult = rowsOf<TotalsRow>(
      (await supabase
        .from("estimate_totals")
        .select("estimate_id, total_cents")
        .in("estimate_id", visibleIds.slice(i, i + TOTALS_IN_CHUNK))) as {
        data: TotalsRow[] | null;
        error: DbErrorLike | null;
      }
    );
    if (!chunkResult.ok) {
      totalsError = chunkResult.error;
      break;
    }
    for (const row of chunkResult.rows) {
      totalsByEstimate.set(row.estimate_id, row.total_cents);
    }
  }
  const missingTotalsCount = totalsError
    ? 0
    : visibleIds.filter((estimateId) => !totalsByEstimate.has(estimateId)).length;

  // A failed totals/expired/clients read is not "no data" — rendering a
  // sent quote as a healthy gray $0.00 because a view read failed is the
  // exact defect class lib/supabase/rows.ts exists to close. A totals row
  // MISSING from a read that succeeded gets the same treatment: the view
  // left-joins from pilot.estimates, so every estimate has exactly one
  // row, and a hole means the answer is "we could not find out".
  const firstError = !estimatesResult.ok
    ? estimatesResult.error
    : !expiredResult.ok
      ? expiredResult.error
      : !clientsResult.ok
        ? clientsResult.error
        : totalsError;
  const errorText = firstError
    ? friendlyDbError(firstError, "estimates.select")
    : missingTotalsCount > 0
      ? `The totals for ${missingTotalsCount} of these estimates couldn't be loaded, so the list isn't shown. A figure that couldn't be found must not appear as $0.00. Reload to try again.`
      : null;

  return (
    <LPageShell
      title="Estimates"
      subtitle={
        errorText
          ? "Some figures below couldn't load. See the notice."
          : `${estimates.length} estimate${estimates.length === 1 ? "" : "s"}${
              awaitingCount ? ` · ${awaitingCount} awaiting an answer` : ""
            }${expiredIds.size ? ` · ${expiredIds.size} expired` : ""}`
      }
      // THE ONE FILLED ACCENT BUTTON on this screen (docs/design/LEDGER.md's
      // restraint rule) — every filter chip and row action below is outline
      // or quiet.
      action={
        <NextLink href="/estimates/new" className={lButtonClass({ variant: "primary" })}>
          New estimate
        </NextLink>
      }
    >
      {truncated ? (
        <LAlert tone="warn" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            {`Only the most recent ${LIST_LIMIT} estimates could be loaded, so the list below covers those and not your whole history.`}
          </span>
        </LAlert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <NextLink
              key={f.key}
              href={f.key === "open" ? "/estimates" : `/estimates?show=${f.key}`}
              className={lButtonClass({ variant: active ? "outline" : "quiet", size: "sm" })}
            >
              {f.label}
            </NextLink>
          );
        })}
      </div>

      <LCard>
        {errorText ? (
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{errorText}</span>
          </LAlert>
        ) : visible.length === 0 ? (
          // "No estimates yet" is only true when there are none at all —
          // saying it while a filter hides the rest is the class of lie
          // the trips screens used to tell. Empty ≠ failed ≠ filtered.
          estimates.length === 0 ? (
            <LEmpty
              title="No estimates yet"
              action={
                <NextLink href="/estimates/new" className={lButtonClass({ variant: "outline" })}>
                  Draft your first estimate
                </NextLink>
              }
            >
              Quote the trip before it&rsquo;s booked: day rates, travel days, per
              diem. When the client accepts, the estimate becomes a draft invoice
              without retyping a number.
            </LEmpty>
          ) : (
            <LEmpty
              title={
                filter === "open"
                  ? "Nothing open"
                  : filter === "expired"
                    ? "Nothing expired"
                    : "Nothing here"
              }
              action={
                <NextLink
                  href="/estimates?show=all"
                  className={lButtonClass({ variant: "outline" })}
                >
                  Show all estimates
                </NextLink>
              }
            >
              {filter === "open"
                ? `Every estimate has an answer. You have ${estimates.length} in total.`
                : `None of your ${estimates.length} estimates match this filter.`}
            </LEmpty>
          )
        ) : (
          <LTable>
            <caption>
              <span className="sr-only">Estimates</span>
            </caption>
            <thead>
              <tr>
                <LTh>Number</LTh>
                <LTh>Client</LTh>
                <LTh>Issued</LTh>
                <LTh>Valid until</LTh>
                <LTh>Status</LTh>
                <LTh numeric>Total</LTh>
              </tr>
            </thead>
            <tbody>
              {visible.map((estimate) => {
                const badge = ESTIMATE_STATUS_BADGE[estimate.status] ?? ESTIMATE_STATUS_FALLBACK;
                const expired = expiredIds.has(estimate.id);
                return (
                  <tr key={estimate.id}>
                    {/* scope="row": the accessible-name row header Radix's
                        Table.RowHeaderCell gave this cell, restated as a
                        plain <th> since LTd has no row-header variant —
                        same idiom as invoices/page.tsx. Without it a
                        screen reader announces Client/Status/Total with
                        no estimate identifier attached. */}
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                    >
                      <NextLink
                        href={`/estimates/${estimate.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {estimate.estimate_number ?? "Draft"}
                      </NextLink>
                    </th>
                    <LTd>
                      <span className="text-ink-2">
                        {clientNames.get(estimate.client_id) ?? "—"}
                      </span>
                    </LTd>
                    <LTd>
                      <span className="text-ink-2">{formatDate(estimate.issued_on)}</span>
                    </LTd>
                    <LTd>
                      <span className={expired ? "font-medium text-warn" : "text-ink-2"}>
                        {formatDate(estimate.valid_until)}
                      </span>
                    </LTd>
                    <LTd>
                      <div className="flex flex-wrap gap-1">
                        {/* estimates_expired only carries SENT quotes past
                            their date (an answered quote is no longer
                            waiting to expire), so this override can never
                            hide an Accepted or Declined badge. */}
                        {expired ? (
                          <LPill tone="warn">Expired</LPill>
                        ) : (
                          <LPill tone={estimateBadgeTone(badge.color)}>{badge.label}</LPill>
                        )}
                        {estimate.converted_invoice_id ? (
                          <LPill tone="neutral">Invoiced</LPill>
                        ) : null}
                      </div>
                    </LTd>
                    <LTd numeric>
                      {/* The table only renders when errorText is null, at
                          which point every visible id verifiably has a
                          totals row — but a missing one still refuses
                          rather than defaulting, so no future regression
                          in the gating above can quietly print $0.00 for
                          "we could not find out". */}
                      {totalsByEstimate.has(estimate.id) ? (
                        <span className="font-medium">
                          {formatCents(totalsByEstimate.get(estimate.id) as number)}
                        </span>
                      ) : (
                        <span className="text-caption text-crit">Couldn&rsquo;t load</span>
                      )}
                    </LTd>
                  </tr>
                );
              })}
            </tbody>
          </LTable>
        )}
      </LCard>
    </LPageShell>
  );
}

/* Local inline icon — same posture as overview/page.tsx's own header rule:
   Ledger screens carry no icon dependency, so a compact 16px outline is
   defined once per file that needs it rather than pulled from a shared
   dependency. */
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
