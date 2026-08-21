import NextLink from "next/link";
import {
  LAlert,
  LCard,
  LEmpty,
  LPill,
  LStat,
  LTable,
  LTd,
  LTh,
  lButtonClass,
} from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import { cn } from "@/lib/ledger/cn";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { countOf } from "@/lib/supabase/rows";
import { DASHBOARD_PATH } from "@/lib/nav";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
// Both of these were dropped by the conflict resolution that merged the
// clientless-invoice branch, while the calls that need them stayed. main
// did not typecheck between that merge and this line. See the usages at
// the unbilled queue and the needs-attention list below.
import { billToListLabel } from "@/lib/invoice-bill-to";
import { isInvoicedCounterparty } from "@/lib/counterparty";
import { EXPIRY_LADDER_BADGE, type ExpiryBadge, type ExpiryTone } from "../documents/expiry-badge";
import {
  clientLabel,
  clientRowsShortfallCents,
  clientRowsState,
  daysSince,
  draftAction,
  draftHref,
  formatDays,
  pluralizeDays,
  sortClientRows,
  unbilledLede,
  type UnbilledClientRow,
  type UnbilledSummaryRow,
  type UnbilledTripMoneyRow,
} from "./unbilled-lib";

export const metadata = { title: "Overview" };

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// The expiry ladder (../documents/expiry-badge.ts) speaks INSTRUMENT's Radix
// Badge colour vocabulary ("red"/"amber"/"green"/"gray") because it is
// shared with the not-yet-migrated documents screen — see that file's
// header on why there must be exactly one ladder→tone mapping. Ledger's
// LPill has its own tone vocabulary, so this is the one translation point
// that vocabulary needs on this screen. A straight, restrained dictionary:
// red→crit, amber→warn, green→good, gray→neutral.
function ladderToPillTone(tone: ExpiryTone): "crit" | "warn" | "good" | "neutral" {
  switch (tone) {
    case "red":
      return "crit";
    case "amber":
      return "warn";
    case "green":
      return "good";
    default:
      return "neutral";
  }
}

// ---------------------------------------------------------------------------
// Row shapes for the boundary cast. `.select()` against database.types.ts
// resolves to `never` (see lib/supabase/account.ts's comment on the same
// issue), so every query result is reasserted to its real row type here,
// once, at the point it crosses from Supabase into this component.
// ---------------------------------------------------------------------------
// The unbilled row shapes are NOT declared here. They belong to
// ./unbilled-lib, beside the pure functions that consume them and the unit
// tests that pin those functions — see that file's header. This page used
// to carry an UnbilledTripRow of its own and price it in JavaScript; that
// arithmetic now lives in pilot.unbilled_trip_money and the shape travels
// with it.

type ClientRow = {
  id: string;
  name: string;
  w9_status: "not_requested" | "requested" | "on_file";
  w9_sent_at: string | null;
  /** 20260815120000. False for an operator the pilot flies for but never bills. */
  you_invoice: boolean;
  archived_at: string | null;
};

type ExpenseRow = {
  id: string;
  trip_id: string | null;
  treatment: "rebill" | "deduct" | "unassigned";
  amount_cents: number;
  /**
   * The date the cost was incurred. Read even though the query is NOT
   * date-filtered, because this one read still feeds figures at two
   * different scopes: the "unassigned receipts" nudge in "Needs attention"
   * is ALL-TIME (a receipt filed last December and never sorted is exactly
   * the one worth surfacing, and a year filter on the query would hide it
   * every January), while the deductible KPI sits under a "This calendar
   * year" heading and must be cut to that year. So the cut is made in JS,
   * per figure.
   *
   * This read no longer prices anything. Rebillable receipts on unbilled
   * trips are summed by pilot.unbilled_trip_money now, which is why the
   * unbilled figure is no longer exposed to this read's AGGREGATE_LIMIT
   * truncation.
   */
  incurred_on: string;
};

type LiveInvoiceRow = {
  id: string;
  // Nullable since 20260815100000. The awaiting-payment total and the overdue
  // queue below read every live invoice, with or without a client, because a
  // clientless invoice that is genuinely owed money belongs in the pilot's
  // receivables exactly as much as any other. Only the LABEL differs, and
  // billToListLabel is what supplies it.
  client_id: string | null;
  bill_to_name: string | null;
  invoice_number: string | null;
  due_on: string | null;
};

type OverdueRow = {
  invoice_id: string;
  due_on: string;
  days_overdue: number;
};

type InvoiceTotalRow = {
  invoice_id: string;
  balance_due_cents: number;
};

type PaymentRow = {
  invoice_id: string;
  amount_cents: number;
  paid_on: string;
};

type LegRow = {
  trip_id: string;
  leg_date: string;
  from_icao: string | null;
  to_icao: string | null;
};

type ExpirationRow = {
  source_id: string;
  item_kind: string;
  item_label: string;
  expires_on: string;
  days_remaining: number;
  ladder_stage: "overdue" | "t_minus_1" | "t_minus_7" | "t_minus_14" | "t_minus_30" | "ok";
};

// Needed to deep-link an operator-qualification expiration to the client
// record it's held under — pilot.expirations' source_id for these rows is
// the operator_qualifications row id, not the client id (see the "Needs
// attention" comment below), so a second lookup resolves it.
type OperatorQualClientRow = {
  id: string;
  // Nullable since 20260821120000: a qualification whose operator was purged
  // by the account lifecycle keeps the row and clears client_id. Such a row
  // is excluded from pilot.expirations entirely (the view's operator-
  // qualification branches require client_id is not null — archived history
  // must not raise a permanent "overdue" for an operator the pilot no longer
  // flies for), so it should never reach this lookup; typing it honestly
  // means the "no client id, no link" guard below is a real check rather than
  // a formality the compiler thinks is dead.
  client_id: string | null;
};

/** Ordered ICAO chain from a trip's legs, e.g. "KFXE → KTEB → KFXE". */
function buildRoute(legs: LegRow[]): string | null {
  const points: string[] = [];
  for (const leg of legs) {
    if (leg.from_icao && points[points.length - 1] !== leg.from_icao) {
      points.push(leg.from_icao);
    }
    if (leg.to_icao && points[points.length - 1] !== leg.to_icao) {
      points.push(leg.to_icao);
    }
  }
  return points.length ? points.join(" → ") : null;
}

// The ladder vocabulary is shared with the documents screen and lives in
// app/(app)/documents/expiry-badge.ts — see ladderToPillTone above for the
// one translation this screen needs on top of it now that its badges are
// Ledger LPills, not Radix Badges.
const LADDER_FALLBACK: ExpiryBadge = { tone: "gray", label: "—" };

const READY_TO_INVOICE_LIMIT = 6;
const NEEDS_ATTENTION_LIMIT = 8;
const EXPIRATIONS_LIMIT = 6;

// Bound for the in-JS aggregate reads below (clients, expenses,
// invoice_payments) — see the query comments for why this must be
// explicit rather than left to the Data API's own silent cap.
const AGGREGATE_LIMIT = 1000;

/**
 * The stand-in used when pilot.unbilled_summary could not be read.
 *
 * That function returns exactly ONE row in every success case, including
 * "nothing is unbilled" — an ungrouped aggregate over an empty input still
 * produces a row of zeros. So no row coming back is never the fact "you
 * have nothing unbilled"; it is the fact "we could not find out", and this
 * object exists ONLY so the render has a shape to destructure. Every figure
 * it would feed is gated behind `moneyOk` and prints "—" instead. Reading
 * these zeros as data is exactly the reassuring-zero defect
 * lib/supabase/rows.ts was written to close.
 */
const UNREADABLE_SUMMARY: UnbilledSummaryRow = {
  client_count: 0,
  trip_count: 0,
  billable_days: 0,
  day_value_cents: 0,
  rebill_expense_cents: 0,
  total_cents: 0,
  oldest_ends_on: null,
};

export default async function OverviewPage() {
  // The argument is the post-login return path (lib/supabase/account.ts
  // threads it through as ?next=), so it must name THIS screen. It said "/"
  // — left over from when Overview served at the root — which is the only
  // one of the repo's ~70 requireAccount call sites that did not pass its
  // own route.
  const { account } = await requireAccount(DASHBOARD_PATH);

  const supabase = await createClient();

  // Start of the current calendar year, UTC — matches the date-column
  // convention lib/format.ts documents (a `date` column is a calendar
  // fact, not an instant).
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;

  // ---------------------------------------------------------------------
  // Phase 1 — everything that doesn't depend on another query's result.
  // ---------------------------------------------------------------------
  const [
    unbilledSummaryRes,
    unbilledClientsRes,
    unbilledTripsRes,
    clientsRes,
    expensesRes,
    liveInvoicesRes,
    overdueRes,
    paymentsRes,
    expirationsRes,
    operatorQualExpirationsRes,
    voidInvoicesRes,
    unmarkedTripsRes,
    anyClientCountRes,
    anyTripCountRes,
    anyInvoiceCountRes,
    reminderFailuresRes,
  ] = await Promise.all([
    // ---------------------------------------------------------------
    // THE UNBILLED SURFACE — three reads, ONE definition.
    //
    // pilot.unbilled_summary → pilot.unbilled_by_client →
    // pilot.unbilled_trip_money is a derivation chain in the database
    // (20260813010000_unbilled_money_reads.sql), so the headline figure,
    // the per-client rows and the trip list on this screen are the same
    // number at three levels of detail and cannot disagree. That is the
    // whole reason the day-money arithmetic moved out of this file: it
    // used to be computed here in JS from three separate reads (trips,
    // trip_days, day_types) plus a fourth for the rebillable receipts,
    // and every panel that wanted the figure re-derived it.
    //
    // The `as never` on the args is this codebase's standing .rpc()
    // boundary cast — see trips/actions.ts and accounting/page.tsx for
    // the same call shape against the same hand-authored types.
    //
    // NO .limit() ON THE FIRST TWO. The summary is one row by
    // construction, and the client rollup is O(clients). Neither can be
    // shortchanged by the Data API's silent row cap the way the raw
    // trips/expenses reads below still can — and where the client rows
    // COULD in principle be capped, clientRowsShortfallCents below
    // detects it by comparing their sum against the summary rather than
    // guessing from an array length.
    supabase.rpc("unbilled_summary", { target_account_id: account.id } as never),
    supabase.rpc("unbilled_by_client", { target_account_id: account.id } as never),
    // Only what "Ready to invoice" renders — the count beside that list and
    // its "+N more" come from the summary, never from this array's length.
    //
    // The .order() is REDUNDANT WITH the function's own `order by
    // starts_on, ends_on, id` and is here anyway: a set-returning function
    // in a FROM clause has no guaranteed row order, so relying on the
    // body's ORDER BY surviving the wrapper PostgREST puts around it would
    // be relying on unspecified behaviour to decide WHICH six trips a pilot
    // is shown. Stated at the API level, "the six that have been waiting
    // longest" is a promise the query makes rather than one the planner
    // happens to keep.
    //
    // ALL THREE KEYS, INCLUDING trip_id — the function body's tiebreaker
    // restated, not just its first two. Same-day trips for different clients
    // are ordinary (four one-day trips on one date is a normal week), and
    // with only two keys the tied rows are ordered arbitrarily and then CUT
    // at the limit: a trip appears, the pilot reloads, a sibling has taken
    // its place. Restating two of three keys would leave exactly the
    // arbitrariness this .order() exists to remove.
    supabase
      .rpc("unbilled_trip_money", { target_account_id: account.id } as never)
      .order("starts_on", { ascending: true })
      .order("ends_on", { ascending: true })
      .order("trip_id", { ascending: true })
      .limit(READY_TO_INVOICE_LIMIT),
    // .limit(1000): Supabase's Data API caps rows (commonly 1000) and
    // TRUNCATES SILENTLY on a plain select — no error, just a shorter
    // array, so a summed KPI from a truncated read would be silently
    // wrong. The limit is explicit here so truncation is DETECTABLE
    // (rows.length === the limit) rather than invisible; see the
    // AGGREGATE_LIMIT truncation check below. The real fix is a
    // server-side aggregate (an RPC or a view) — deferred to a later pass.
    supabase
      .from("clients")
      .select("id, name, w9_status, w9_sent_at, archived_at, you_invoice")
      .limit(AGGREGATE_LIMIT),
    supabase
      .from("expenses")
      .select("id, trip_id, treatment, amount_cents, incurred_on")
      .limit(AGGREGATE_LIMIT),
    // "Awaiting payment" per the spec is issued invoices (sent, or sent
    // with a partial payment already applied) — 'draft' has nothing billed
    // yet and 'paid'/'void' owe nothing, per invoices_protect_issued's own
    // state machine.
    // .limit(AGGREGATE_LIMIT): "Awaiting payment" (awaitingCents below) sums
    // this read directly — an unbounded read here is the exact silent-
    // truncation risk the clients/expenses/payments reads above already
    // guard against, just missed when this query was written.
    supabase
      .from("invoices")
      .select("id, client_id, bill_to_name, invoice_number, due_on")
      .in("status", ["sent", "partial"])
      .limit(AGGREGATE_LIMIT),
    supabase
      .from("invoices_overdue")
      .select("invoice_id, due_on, days_overdue")
      .limit(AGGREGATE_LIMIT),
    supabase
      .from("invoice_payments")
      .select("invoice_id, amount_cents, paid_on")
      .gte("paid_on", yearStart)
      .limit(AGGREGATE_LIMIT),
    // Document expiries — medical, flight review, passport, insurance and
    // the 61.58 PIC proficiency check. The currency engine (day/night/
    // instrument recency computed from logbook legs) is Phase 7 and is
    // deliberately not built here: it ships behind a flag only after an
    // owner spec review and counsel sign-off on its own disclaimer.
    // Filtering item_kind keeps this panel honest about what
    // pilot.expirations actually gives it for the OTHER document kinds it
    // also carries (certificate, w9, other) — a certificate never expires
    // (see documents/kinds.ts) and w9/other carry no expiry date at all.
    // insurance and pic_proficiency_check belong here for the same reason
    // medical/flight_review/passport do: a lapsed one is a harder stop for
    // a working contract pilot than a passport, and both are the same
    // pilot-typed, no-computed-verdict shape as the three kinds already
    // shown.
    supabase
      .from("expirations")
      .select("source_id, item_kind, item_label, expires_on, days_remaining, ladder_stage")
      .in("item_kind", [
        "medical",
        "flight_review",
        "passport",
        "insurance",
        "pic_proficiency_check",
      ])
      .order("expires_on", { ascending: true })
      // AGGREGATE_LIMIT here too: this panel already slices to
      // EXPIRATIONS_LIMIT for display, but a silent API truncation would
      // happen upstream of that slice — a pilot with a very large document
      // history could have a near-due row fall out of the read entirely,
      // not just off the visible list.
      .limit(AGGREGATE_LIMIT),
    // Operator qualifications — 135.293/135.297/135.299 checks and the
    // status-only rows, all unioned into pilot.expirations with
    // source_table='operator_qualification' (20260807060000). Filtered by
    // source_table rather than an item_kind allowlist so this stays
    // correct if the requirement CHECK ever grows a kind — unlike the
    // documents panel above, EVERY operator-qualification kind belongs in
    // the attention queue, there's no "not this panel's concern" subset to
    // exclude. ladder_stage != 'ok' reuses the same ladder the documents
    // panel and pilot.expirations itself define, rather than inventing a
    // day-count threshold here. This feeds "Needs attention", NOT the
    // "Document expirations" panel — an operator qualification is a status
    // on someone else's certificate, not the pilot's own document; see
    // that panel's query comment above.
    supabase
      .from("expirations")
      .select("source_id, item_kind, item_label, expires_on, days_remaining, ladder_stage")
      .eq("source_table", "operator_qualification")
      .neq("ladder_stage", "ok")
      .order("expires_on", { ascending: true })
      .limit(AGGREGATE_LIMIT),
    // invoice_totals/invoice_payments' own comment: amount_paid_cents sums
    // EVERY payment row regardless of the invoice's current status,
    // including 'void' (partial -> void is a legal transition). "Paid this
    // year" must filter those out itself rather than trusting the raw
    // ledger, or a voided invoice's old payment counts as money collected.
    // .limit(AGGREGATE_LIMIT): a silently truncated read here would drop
    // some void ids from voidInvoiceIds below, letting a stale voided
    // invoice's payment count TOWARD "Paid this year" — the wrong
    // direction for a KPI whose whole job is excluding it.
    supabase.from("invoices").select("id").eq("status", "void").limit(AGGREGATE_LIMIT),
    // Trips logged but never marked flown. "Ready to invoice" below stays
    // strictly completed trips — widening THAT query would put unflown
    // work in front of a pilot as billable. This count only feeds the
    // sentence that used to read "0 trips flown and logged but not yet
    // invoiced" to a pilot with a month of unbilled flying, because
    // nothing in the product ever advanced a trip out of Scheduled.
    supabase
      .from("trips")
      .select("id", { count: "exact", head: true })
      .in("status", ["scheduled", "in_progress"]),
    // GETTING STARTED — three unfiltered existence counts, one per step
    // whose done-state is a database fact. They are deliberately NOT the
    // filtered reads above: "you have a trip" is not "you have a
    // completed, unbilled trip", and a pilot who logged a trip and
    // invoiced it must not be told to log their first one. Every one is
    // unwrapped through countOf (lib/supabase/rows.ts) below, because a
    // failed count that fell to 0 would render as "step not done" — an
    // unticked box is this panel's version of the reassuring zero that
    // file exists to prevent.
    supabase.from("clients").select("id", { count: "exact", head: true }),
    supabase.from("trips").select("id", { count: "exact", head: true }),
    supabase.from("invoices").select("id", { count: "exact", head: true }),
    // SCHEDULED REMINDERS THAT DID NOT GO OUT (20260813130000).
    //
    // This is the queue item the whole reminder feature owes its existence
    // to being honest about. A pilot who has switched chasing on believes it
    // is happening; the one state that must never be quiet is "the product
    // tried, the mail service refused, and the invoice is still sitting
    // there". Today's most likely cause is the unverified sending domain
    // (LAUNCH-GATES G5), which produces a 403 per attempt — visible here as
    // a row, never as a pretend send.
    //
    // Newest first and bounded: this panel shows a handful, and the invoice's
    // own reminder panel carries the full history per invoice.
    //
    // BOTH UNHAPPY OUTCOMES, not just the definite one (20260815090000).
    // 'failed' is a send that did not happen and will be tried again;
    // 'unknown' is one the mail service left unconfirmed, which is never
    // retried and is therefore the one MORE in need of a human. Filtering to
    // 'failed' alone would hide exactly the rows nothing else is going to
    // pick up.
    supabase
      .from("invoice_reminder_sends")
      .select("invoice_id, rule_key, outcome, detail, created_at")
      .in("outcome", ["failed", "unknown"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const unbilledSummary =
    ((unbilledSummaryRes.data ?? []) as UnbilledSummaryRow[])[0] ??
    UNREADABLE_SUMMARY;
  const unbilledClients = (unbilledClientsRes.data ?? []) as UnbilledClientRow[];
  const unbilledTrips = (unbilledTripsRes.data ?? []) as UnbilledTripMoneyRow[];
  const clients = (clientsRes.data ?? []) as ClientRow[];
  const expenses = (expensesRes.data ?? []) as ExpenseRow[];
  const liveInvoices = (liveInvoicesRes.data ?? []) as LiveInvoiceRow[];
  const overdue = (overdueRes.data ?? []) as OverdueRow[];
  const payments = (paymentsRes.data ?? []) as PaymentRow[];
  const expirations = (expirationsRes.data ?? []) as ExpirationRow[];
  const operatorQualExpirations = (operatorQualExpirationsRes.data ?? []) as ExpirationRow[];
  const reminderFailures = (reminderFailuresRes.data ?? []) as {
    invoice_id: string;
    rule_key: string;
    outcome: string;
    detail: string | null;
    created_at: string;
  }[];
  const unmarkedTripCount = unmarkedTripsRes.count ?? 0;
  const voidInvoiceRows = (voidInvoicesRes.data ?? []) as { id: string }[];
  const voidInvoiceIds = new Set(voidInvoiceRows.map((i) => i.id));

  // Hitting the limit exactly is the only client-visible signal that a
  // read was truncated (the Data API returns 200, not an error) — a
  // pilot with 1,400 expenses must see a caveat, not a deductible total
  // silently summed from an arbitrary 1,000 of them. liveInvoices/overdue/
  // voidInvoiceRows/expirations added to this list alongside
  // clients/expenses/payments — same risk, same guard, just missed when
  // those four reads were first written (each carries its own
  // .limit(AGGREGATE_LIMIT) comment above explaining what it feeds).
  const truncatedAggregates = [
    { context: "clients", hit: clients.length === AGGREGATE_LIMIT },
    { context: "expenses", hit: expenses.length === AGGREGATE_LIMIT },
    { context: "payments", hit: payments.length === AGGREGATE_LIMIT },
    { context: "awaiting payment", hit: liveInvoices.length === AGGREGATE_LIMIT },
    { context: "overdue invoices", hit: overdue.length === AGGREGATE_LIMIT },
    { context: "paid this year", hit: voidInvoiceRows.length === AGGREGATE_LIMIT },
    { context: "document expirations", hit: expirations.length === AGGREGATE_LIMIT },
  ]
    .filter((t) => t.hit)
    .map((t) => t.context);

  // ---------------------------------------------------------------------
  // Phase 2 — depends on the trip ids / invoice ids resolved above.
  // ---------------------------------------------------------------------
  // Only the trips actually rendered in "Ready to invoice" — the RPC above
  // is already limited to them, so this route lookup no longer scales with
  // the size of the unbilled backlog the way the old unbounded trips read
  // did.
  const tripIds = unbilledTrips.map((t) => t.trip_id);
  // pilot.invoices_overdue is itself filtered to status in ('sent',
  // 'partial'), so every overdue invoice_id is already a member of
  // liveInvoices — one balance-due lookup covers both.
  const balanceIds = liveInvoices.map((i) => i.id);
  // pilot.expirations' source_id for an operator_qualification row is the
  // qualification row's own id, not the client id the "Open client" link
  // needs — resolved with a second, dependent lookup.
  const operatorQualIds = operatorQualExpirations.map((e) => e.source_id);

  // The trip_days and day_types reads that used to sit in this block are
  // GONE, not moved: they existed solely so this page could price a trip's
  // day grid in JavaScript. pilot.unbilled_trip_money does that arithmetic
  // now, in the database, mirroring lib/trip-value.ts row for row (see the
  // migration header). Two fewer reads, and — more to the point — one fewer
  // place this screen's money could drift from the invoice it previews.
  const [legsRes, totalsRes, operatorQualClientsRes] = await Promise.all([
    tripIds.length
      ? supabase
          .from("trip_legs")
          .select("trip_id, leg_date, from_icao, to_icao")
          .in("trip_id", tripIds)
          .order("leg_date", { ascending: true })
      : Promise.resolve({ data: [] as LegRow[], error: null }),
    balanceIds.length
      ? supabase.from("invoice_totals").select("invoice_id, balance_due_cents").in(
          "invoice_id",
          balanceIds
        )
      : Promise.resolve({ data: [] as InvoiceTotalRow[], error: null }),
    operatorQualIds.length
      ? supabase
          .from("operator_qualifications")
          .select("id, client_id")
          .in("id", operatorQualIds)
          .limit(AGGREGATE_LIMIT)
      : Promise.resolve({ data: [] as OperatorQualClientRow[], error: null }),
  ]);

  const legs = (legsRes.data ?? []) as LegRow[];
  const totals = (totalsRes.data ?? []) as InvoiceTotalRow[];
  const operatorQualClientId = new Map(
    ((operatorQualClientsRes.data ?? []) as OperatorQualClientRow[]).map((r) => [
      r.id,
      r.client_id,
    ])
  );

  // A query error is not "no data" — it must be visible, not quietly
  // rendered as a healthy zero-state dashboard.
  const errors = [
    // Three contexts, not one, because they are three round trips and a
    // pilot reading the banner should know WHICH part of the unbilled
    // picture is missing. They cannot disagree about the money — the
    // functions are one derivation chain — but they can fail
    // independently.
    { context: "your unbilled total", error: unbilledSummaryRes.error },
    { context: "unbilled work by client", error: unbilledClientsRes.error },
    { context: "unbilled trips", error: unbilledTripsRes.error },
    { context: "clients", error: clientsRes.error },
    { context: "expenses", error: expensesRes.error },
    { context: "invoices", error: liveInvoicesRes.error },
    { context: "overdue invoices", error: overdueRes.error },
    { context: "payments", error: paymentsRes.error },
    { context: "document expirations", error: expirationsRes.error },
    { context: "operator qualifications", error: operatorQualExpirationsRes.error },
    { context: "trip routes", error: legsRes.error },
    { context: "invoice balances", error: totalsRes.error },
    { context: "voided invoices", error: voidInvoicesRes.error },
    { context: "operator qualification clients", error: operatorQualClientsRes.error },
    // The fifteenth read, and the one that was missing from this list. It is a
    // head:true COUNT rather than a row read, which is exactly why it got
    // skipped — the eye scans this file for `.data` and this one has none.
    // Its failure was the quiet kind: `count ?? 0` becomes 0, no banner
    // renders because this array stays empty, and the screen silently drops
    // the "N trips are still marked Scheduled" clause that exists to stop a
    // pilot with a month of unbilled flying being told there is nothing to
    // invoice.
    { context: "trips still marked scheduled", error: unmarkedTripsRes.error },
    // A failed read here would hide failed reminders, which is the same
    // silence the rows themselves exist to break.
    { context: "reminder delivery failures", error: reminderFailuresRes.error },
  ].filter((e) => e.error);

  // ---------------------------------------------------------------------
  // Getting started — real state, read fresh from the database on every
  // render. Nothing here is remembered client-side: a pilot who added a
  // client on their laptop must see that step ticked when they open this
  // screen on the flight deck iPad, and a step "completed" in localStorage
  // on a device they no longer use is worse than no checklist at all.
  // ---------------------------------------------------------------------
  const anyClientCount = countOf(anyClientCountRes);
  const anyTripCount = countOf(anyTripCountRes);
  const anyInvoiceCount = countOf(anyInvoiceCountRes);
  const onboardingErrors = [
    { context: "your clients", error: anyClientCount.ok ? null : anyClientCount.error },
    { context: "your trips", error: anyTripCount.ok ? null : anyTripCount.error },
    { context: "your invoices", error: anyInvoiceCount.ok ? null : anyInvoiceCount.error },
  ].filter((e) => e.error);

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const balanceByInvoice = new Map(totals.map((t) => [t.invoice_id, t.balance_due_cents]));
  const legsByTrip = new Map<string, LegRow[]>();
  for (const leg of legs) {
    const list = legsByTrip.get(leg.trip_id) ?? [];
    list.push(leg);
    legsByTrip.set(leg.trip_id, list);
  }

  // KPI 1 — unbilled work. ONE READ, and it is the same read the module
  // below breaks down per client: pilot.unbilled_summary.total_cents.
  //
  // WHAT THIS FIGURE MEANS is unchanged — day-grid (or scalar) day money
  // plus every treatment='rebill' receipt on those trips, which is what the
  // invoice will actually total, because createInvoiceDraft emits a
  // reimbursable_expense line for each of those receipts. What changed is
  // WHERE it is computed. It used to be summed here in JS across four
  // reads, two of which (`expenses`, and the trips read itself) were
  // bounded at AGGREGATE_LIMIT and truncated SILENTLY — so a pilot with
  // more than a thousand receipts had a headline figure quietly built from
  // an arbitrary thousand of them. The database now returns the total as
  // one row, so that failure mode is gone rather than merely flagged.
  //
  // THE RECONCILIATION RULE this page has always enforced now holds by
  // construction instead of by inspection: pilot.unbilled_summary is
  // defined as an aggregate over pilot.unbilled_by_client, which is defined
  // over pilot.unbilled_trip_money. This card, the per-client rows, and the
  // "Ready to invoice" trip list are the SAME NUMBER at three levels of
  // detail. There is no arrangement of the SQL in which they disagree.
  const unbilledCents = Number(unbilledSummary.total_cents);
  // "Oldest" is the elapsed time since the EARLIEST-ENDING unbilled trip,
  // not the earliest-starting one — a later-starting trip that ended sooner
  // has been billable for less time, so measuring from starts_on
  // overstates staleness and picking the first row of a starts_on-ordered
  // list understates it. pilot.unbilled_summary.oldest_ends_on is
  // `min(ends_on)` over every unbilled trip, so this is exact even though
  // only six trip rows were fetched.
  const oldestTripDays = daysSince(unbilledSummary.oldest_ends_on, Date.now()) ?? 0;
  // The COUNT of unbilled trips, from the same aggregate — deliberately not
  // `unbilledTrips.length`, which is the length of a deliberately limited
  // read and would report "6 trips" to a pilot with forty.
  const readyCount = Number(unbilledSummary.trip_count);

  // KPI 2 — awaiting payment: balance_due_cents from pilot.invoice_totals,
  // for issued (sent/partial) invoices. This is the ONLY place this figure
  // is computed — invoice_totals is invoices' single source for the number
  // per its own comment.
  const awaitingCents = liveInvoices.reduce(
    (sum, inv) => sum + (balanceByInvoice.get(inv.id) ?? 0),
    0
  );

  // KPI 3 — paid this year: the cash-basis ledger (pilot.invoice_payments),
  // summed by the date the money actually arrived, within this calendar
  // year — not by invoice status, which is exactly the C3 distinction the
  // invoices migration documents. EXCLUDING payments against invoices now
  // 'void': partial -> void is a legal transition, and invoice_totals'
  // own comment warns that its paid sum still includes those rows — a
  // "collected this year" figure has to filter status itself or it counts
  // money against a document that no longer bills for anything.
  const yearPayments = payments.filter((p) => !voidInvoiceIds.has(p.invoice_id));
  const paidCents = yearPayments.reduce((sum, p) => sum + p.amount_cents, 0);

  // KPI 4 — deductible expenses: treatment='deduct', WITHIN THIS CALENDAR
  // YEAR. The year cut is not decoration: this card sits under the "This
  // calendar year" group heading (KPI_GROUPS below, which is also the
  // <section aria-label>), beside "Paid this year", and an all-time sum
  // under that heading is a false statement about a number a pilot takes
  // to their accountant. The cut is made HERE rather than on the query
  // because the same `expenses` read also feeds the all-time
  // unassigned-receipts nudge — see ExpenseRow.incurred_on. Same year
  // boundary as the payments read (`yearStart`), so the two figures in
  // the group agree about what "this year" means.
  const deductibleExpenses = expenses.filter(
    (e) => e.treatment === "deduct" && e.incurred_on >= yearStart
  );
  const deductibleCents = deductibleExpenses.reduce((sum, e) => sum + e.amount_cents, 0);

  // THE RULE: a query error is not "no data" — see the block comment above
  // `errors`. Every KPI below is a sum over at least one of the reads in
  // that array (pilot.unbilled_summary feeds unbilledCents; invoice
  // balances/live invoices feed awaitingCents; payments/void invoices feed
  // paidCents; expenses feeds deductibleCents),
  // so any read failing means every one of these four sums is potentially
  // built on a partial or empty input. Rather than track which specific
  // combination of the reads above happens to back each card —
  // fragile, and wrong the next time a query is added to Phase 1 above
  // this without its dependants being re-audited — a failure ANYWHERE on
  // this page holds back the concrete figure on ALL four. This is exactly
  // the U2 defect (a failed read prints "$0.00" of real billable work —
  // and note that pilot.unbilled_summary returns a row of ZEROS in the
  // genuinely-nothing-unbilled case, so its failure branch is
  // indistinguishable from good news without this gate) and it is not
  // unique to that one card: an awaitingCents built
  // from a failed invoice_totals read would print "No invoices
  // outstanding" to a pilot who has several, which is the Rule's own
  // worked example of the worse lie.
  const moneyOk = errors.length === 0;

  /**
   * THE MONEY ROW, GROUPED. The four figures were one undifferentiated
   * row of identical cards, which is why the screen read as a wall of
   * numbers rather than as an answer to a question. They are in fact TWO
   * pairs answering two different questions, and saying so is the whole
   * hierarchy fix:
   *
   *   "Owed to you"        work done that hasn't turned into money yet —
   *                        live, actionable, and the reason to open this
   *                        screen.
   *   "This calendar year"  what has already happened — a running total
   *                        for the tax conversation, not a to-do.
   *
   * NO NEW FIGURE IS INVENTED HERE. Each keeps the single source it
   * already had (see the four blocks above); `group`, `href` and `hint`
   * are presentation. `href` sends the pilot to the screen that can
   * explain the number, which is what a figure on a dashboard is for.
   */
  const KPIS = [
    {
      id: "unbilled",
      group: "owed" as const,
      label: "Unbilled work",
      value: moneyOk ? formatCents(unbilledCents) : "—",
      hint: "Completed trips, priced from their day grids and rebillable receipts",
      href: "/trips",
      sub: !moneyOk
        ? "Couldn't load"
        : readyCount
          ? `${pluralize(readyCount, "trip")} · oldest ${pluralize(oldestTripDays, "day")}`
          : "No unbilled trips",
    },
    {
      id: "awaiting",
      group: "owed" as const,
      label: "Awaiting payment",
      value: moneyOk ? formatCents(awaitingCents) : "—",
      hint: "Balance still due on invoices you've issued",
      href: "/invoices?show=outstanding",
      sub: !moneyOk
        ? "Couldn't load"
        : liveInvoices.length
          ? pluralize(liveInvoices.length, "invoice")
          : "No invoices outstanding",
    },
    {
      id: "paid",
      group: "year" as const,
      label: "Paid this year",
      value: moneyOk ? formatCents(paidCents) : "—",
      hint: "Cash actually received, by the date it arrived",
      href: "/reports/profit-loss",
      sub: !moneyOk
        ? "Couldn't load"
        : yearPayments.length
          ? pluralize(yearPayments.length, "payment")
          : "No payments recorded this year",
    },
    {
      id: "deductible",
      group: "year" as const,
      label: "Deductible expenses",
      value: moneyOk ? formatCents(deductibleCents) : "—",
      hint: "Receipts you tagged deduct, not rebill, dated this year",
      href: "/expenses",
      sub: !moneyOk
        ? "Couldn't load"
        : deductibleExpenses.length
          ? `${pluralize(deductibleExpenses.length, "receipt")} filed this year`
          : "No deductible expenses filed this year",
    },
  ];

  const KPI_GROUPS = [
    { id: "owed" as const, label: "Owed to you" },
    { id: "year" as const, label: `This calendar year` },
  ];

  // -----------------------------------------------------------------------
  // The unbilled module — per-client rows, sorted biggest-first.
  //
  // Every column here comes from pilot.unbilled_by_client, which is the
  // KPI's own source one level down. Nothing is re-added in JavaScript: the
  // one arithmetic operation performed on these rows is the RECONCILIATION
  // CHECK below, whose entire job is to notice if the set arrived
  // incomplete.
  // -----------------------------------------------------------------------
  const unbilledClientRows = sortClientRows(unbilledClients);
  const namedClientRows = unbilledClientRows.filter((r) => r.client_id);
  const hasUnassignedBucket = unbilledClientRows.some((r) => !r.client_id);
  // The client rows sum to the headline total in the database by
  // construction — but they travel here as a SET, and a set can be capped
  // in transit while the one-row total cannot. A shortfall is the only
  // signal that happened, and it is a stronger one than
  // `rows.length === limit`, because it compares the actual money, the trip
  // count and the bucket count rather than guessing from an array length.
  //
  // THE STATE, NOT JUST THE NUMBER. `shortfall !== 0` is not the same
  // question as "was this list capped": the three unbilled reads are three
  // PostgREST requests and therefore three transactions, so a write landing
  // between them can leave the rows claiming MORE than the total. That is
  // not truncation and must not be described as it — see clientRowsState.
  const unbilledShortfallCents = clientRowsShortfallCents(
    unbilledSummary,
    unbilledClientRows
  );
  const unbilledBreakdown = clientRowsState(unbilledSummary, unbilledClientRows);
  // "…across 3 clients" is COUNTED FROM THE ROWS, so a capped row set would
  // make that clause say 3 when the truth is 40 — a wrong number in the
  // module's opening line, which is the worst place on the screen to put
  // one. Whenever the rows are anything but a complete view the sentence is
  // withheld entirely and the caveat beneath the table says what happened
  // instead. Withholding is the honest move: the total is still
  // trustworthy, the count is not, and there is no version of the sentence
  // that says only the trustworthy half.
  const unbilledSentence =
    unbilledBreakdown === "complete"
      ? unbilledLede(
          unbilledSummary,
          namedClientRows.length,
          hasUnassignedBucket,
          formatCents
        )
      : null;

  // ONE SET OF CELLS, TWO LAYOUTS. The module renders as a stacked list on a
  // phone and as a table from md up (see the JSX below for why), and every
  // figure is formatted HERE so the two cannot drift into saying different
  // things about the same client. Nothing is computed in this map that isn't
  // already in the row — it is labelling and formatting only, per this
  // module's standing rule that no money is re-added in JavaScript.
  const unbilledDisplayRows = unbilledClientRows.map((row) => ({
    key: row.client_id ?? "no-client",
    clientId: row.client_id,
    label: clientLabel(row),
    waiting: daysSince(row.oldest_ends_on, Date.now()),
    trips: Number(row.trip_count),
    days: formatDays(Number(row.billable_days)),
    dayMoney: formatCents(Number(row.day_value_cents)),
    reimbursables: formatCents(Number(row.rebill_expense_cents)),
    total: formatCents(Number(row.total_cents)),
  }));

  // Ready to invoice — client, route, tail number, day count, dates, and a
  // rate-plus-expenses split, so the figure on this card is traceable to
  // the same two numbers the eventual invoice line items will show.
  //
  // The split, the day count and the total all come from
  // pilot.unbilled_trip_money now. Worth noting what that FIXED rather than
  // merely moved: `days` used to be `day_count + travel_day_count` — the
  // scalar columns — even for a trip priced from its day grid, so a trip
  // whose grid disagreed with those columns showed a day count that had
  // nothing to do with the money printed beside it. The database counts the
  // billable days it actually priced.
  const readyTrips = unbilledTrips.map((trip) => {
    const rateCents = Number(trip.day_value_cents);
    const expenseCents = Number(trip.rebill_expense_cents);
    return {
      id: trip.trip_id,
      client: clientLabel(trip),
      route: buildRoute(legsByTrip.get(trip.trip_id) ?? []),
      tail: trip.aircraft_ident,
      dates: formatDateRange(trip.starts_on, trip.ends_on),
      days: Number(trip.billable_days),
      amountCents: rateCents + expenseCents,
      detail: expenseCents
        ? `${formatCents(rateCents)} rate + ${formatCents(expenseCents)} exp`
        : `${formatCents(rateCents)} rate`,
    };
  });

  // M12: the invoice draft flow is single-client by construction
  // (/invoices/new drafts against exactly one client's trips), so "Invoice
  // N trips" can only be honest when every one of those N unbilled trips
  // shares a client. When they don't, the button must stop promising a
  // multi-client batch it cannot perform.
  //
  // Read off the per-client rollup rather than off the trip list, which is
  // now limited to six: a pilot with forty unbilled trips for one client
  // would otherwise have this answered from a sample. And note that the
  // module below is what actually dissolves the limitation — a row per
  // client, each with its own single-client draft link, is the honest
  // version of the batch button this fallback exists to avoid promising.
  const soleClientId =
    namedClientRows.length === 1 && !hasUnassignedBucket
      ? namedClientRows[0]?.client_id ?? null
      : null;

  // Needs attention — past-due invoices, unassigned receipts, and clients
  // missing a W-9. Built as the FULL, unsliced list first and counted from
  // THAT — the previous version sliced overdue to 8 and W-9s to 3 but
  // summed the unsliced lengths for the header count, so the count and the
  // rendered list could never agree (a header of "20 items" while only 8
  // rendered), and a long overdue list could push the unassigned-receipts
  // item — the highest-value nudge on this panel — off the list entirely.
  const overdueItemsAll = overdue.map((row) => {
    const invoice = liveInvoices.find((i) => i.id === row.invoice_id);
    return {
      id: `overdue-${row.invoice_id}`,
      // `band` names WHY this item is where it is in the list. The
      // ordering below was already deliberate and documented; the badge is
      // what makes it legible, so a pilot can see that a lapsed
      // qualification outranks a late invoice rather than having to infer
      // it from position. Tone follows the same judgement, translated to
      // Ledger's pill vocabulary (crit/warn/neutral).
      band: "Invoice" as const,
      tone: "warn" as const,
      label: `${invoice?.invoice_number ?? "Invoice"} past due`,
      detail: `${
        invoice ? billToListLabel(invoice, clientName) : "Unknown client"
      } · ${formatCents(balanceByInvoice.get(row.invoice_id) ?? 0)} · ${pluralize(
        row.days_overdue,
        "day"
      )}`,
      // M11: "Remind" named an action this product cannot perform —
      // nothing here sends mail. This only opens the invoice record, so
      // it's labeled for that, matching the fix already applied to the
      // W-9 button below. Deep-linked to the invoice itself, not the
      // list, now that invoice.invoice_id is in scope here.
      action: "Open invoice",
      href: `/invoices/${row.invoice_id}`,
    };
  });

  // Lapsing operator qualifications — a 135.293/.297/.299 check (or a
  // drug & alcohol / PRD status row) past or nearing its ladder threshold.
  // item_label already reads "<operator name> — <requirement>[ (type)]"
  // (pilot.expirations' own union, 20260807060000), so no separate
  // client-name join is needed for the label — only for the href, via
  // operatorQualClientId resolved in Phase 2. A row with no client id is
  // dropped rather than linked to nothing. Two ways that can happen: a
  // partial/truncated read, or a qualification detached by the lifecycle
  // purge (client_id null, 20260821120000). The second cannot actually reach
  // here — pilot.expirations excludes detached rows — but the guard is what
  // makes that a belt-and-braces rather than an assumption, and "Open client"
  // has no client to open either way.
  const operatorQualItemsAll = operatorQualExpirations.flatMap((row) => {
    const clientId = operatorQualClientId.get(row.source_id);
    if (!clientId) return [];
    return [
      {
        id: `operator-qual-${row.source_id}`,
        // Crit, and first. A lapsed 135.293/.297/.299 check is the ability
        // to fly for that operator at all — a harder stop than money.
        band: "Qualification" as const,
        tone: "crit" as const,
        label: row.item_label,
        detail:
          row.ladder_stage === "overdue"
            ? `Expired ${formatDate(row.expires_on)}`
            : `Expires ${formatDate(row.expires_on)}`,
        // Same rule as the W-9 button below: this only opens the client
        // record, it doesn't renew or schedule anything.
        action: "Open client",
        href: `/clients/${clientId}`,
      },
    ];
  });

  // REMINDERS THAT DID NOT GO OUT — above the overdue invoices they concern.
  //
  // "This invoice is 20 days late" and "we tried to chase it and could not"
  // are different facts, and the second is the one the pilot cannot discover
  // any other way: nothing arrives, nothing bounces, and the invoice screen
  // looks exactly as it did. Scoped to invoices that are STILL live —
  // liveInvoices is already sent/partial only — so a failure on an invoice
  // since paid drops off by itself rather than nagging about settled money.
  const reminderFailureItemsAll = reminderFailures.flatMap((row) => {
    const invoice = liveInvoices.find((i) => i.id === row.invoice_id);
    if (!invoice) return [];
    return [
      {
        id: `reminder-failed-${row.invoice_id}-${row.rule_key}`,
        band: "Reminder" as const,
        // Crit: a chase the pilot believes is happening and is not. An
        // unconfirmed send is warn instead, because the honest state is a
        // question rather than a fault, and only the pilot can answer it.
        tone: row.outcome === "unknown" ? ("warn" as const) : ("crit" as const),
        label:
          row.outcome === "unknown"
            ? `Reminder not confirmed · ${invoice.invoice_number ?? "Invoice"}`
            : `Reminder didn't send · ${invoice.invoice_number ?? "Invoice"}`,
        detail: `${
          billToListLabel(invoice, clientName)
        } · ${formatDate(row.created_at)} · ${
          // The mail service's own words, trimmed to fit the row. Truncated
          // rather than replaced by a generic line: "The domain is not
          // verified" is the difference between a five-minute DNS fix and an
          // afternoon of guessing, and the invoice's own panel carries it in
          // full.
          (row.detail ?? "No reason recorded").slice(0, 90)
        }`,
        action: "Open invoice",
        href: `/invoices/${row.invoice_id}`,
      },
    ];
  });

  const unassignedCount = expenses.filter((e) => e.treatment === "unassigned").length;
  const unassignedItem = unassignedCount
    ? [
        {
          id: "unassigned-receipts",
          band: "Receipts" as const,
          tone: "warn" as const,
          label: `${pluralize(unassignedCount, "receipt")} unassigned`,
          detail: "Won't be billed or deducted",
          action: "Sort",
          href: "/expenses",
        },
      ]
    : [];

  // A W-9 is what a client needs in order to 1099 the pilot for money
  // paid. A counterparty the pilot does not invoice (20260815120000) is
  // never paying them, so an outstanding W-9 there is not a thing to
  // chase: it is one row of noise per training relationship on the queue
  // whose whole job is to make the real ones visible.
  const w9Clients = clients.filter(
    (c) => !c.archived_at && c.w9_status !== "on_file" && isInvoicedCounterparty(c)
  );
  const w9ItemsAll = w9Clients.map((c) => ({
    id: `w9-${c.id}`,
    band: "Paperwork" as const,
    tone: "neutral" as const,
    label: `W-9 outstanding · ${c.name}`,
    detail:
      c.w9_status === "requested"
        ? `Requested ${formatDate(c.w9_sent_at)}`
        : "Not yet requested",
    // "Open client", not "Request"/"Resend" — this button only navigates
    // to the client record, it doesn't send anything. A verb that
    // performs no action is a defect; label it for what it actually does.
    // Deep-linked to the client itself, not the list — c.id is in scope
    // here.
    action: "Open client",
    href: `/clients/${c.id}`,
  }));

  const attentionItemsAll = [
    ...operatorQualItemsAll,
    ...reminderFailureItemsAll,
    ...overdueItemsAll,
    ...unassignedItem,
    ...w9ItemsAll,
  ];
  const attentionCount = attentionItemsAll.length;

  // Display list: the unassigned-receipts item gets a slot reserved for it
  // before everything else fills the rest, so it can never be starved out
  // by a long overdue/qualification list the way the previous
  // concatenate-then-slice did.
  //
  // Within the remaining slots, operator qualifications are prioritized
  // ABOVE overdue invoices: an overdue invoice is money already earned and
  // owed, recoverable whenever it's chased down, but a lapsed 135.297 IPC
  // or 135.293 competency check is the ability to fly for that operator at
  // all — a harder, more time-sensitive stop than a late payment.
  const reservedSlots = unassignedItem.length;
  const remainingSlots = Math.max(0, NEEDS_ATTENTION_LIMIT - reservedSlots);
  const operatorQualDisplay = operatorQualItemsAll.slice(0, remainingSlots);
  // Above overdue invoices, below qualifications: a reminder that failed is a
  // late invoice PLUS a broken assumption about it being chased, so it
  // outranks the plain late invoice — and a lapsed check still outranks both,
  // for the reason set out above.
  const reminderFailureDisplay = reminderFailureItemsAll.slice(
    0,
    Math.max(0, remainingSlots - operatorQualDisplay.length)
  );
  const overdueDisplay = overdueItemsAll.slice(
    0,
    Math.max(
      0,
      remainingSlots - operatorQualDisplay.length - reminderFailureDisplay.length
    )
  );
  const w9Display = w9ItemsAll.slice(
    0,
    Math.max(
      0,
      remainingSlots -
        operatorQualDisplay.length -
        reminderFailureDisplay.length -
        overdueDisplay.length
    )
  );
  const NEEDS_ATTENTION = [
    ...operatorQualDisplay,
    ...reminderFailureDisplay,
    ...overdueDisplay,
    ...unassignedItem,
    ...w9Display,
  ];
  const attentionMoreCount = attentionCount - NEEDS_ATTENTION.length;

  const expirationRows = expirations.slice(0, EXPIRATIONS_LIMIT);

  // Day one: the screen every other first-run empty state (/trips,
  // /clients, /invoices, /expenses, /logbook) is reached from, but with
  // nothing logged anywhere it renders four $0.00 KPI cards and says
  // nothing about what the product is for. True zero-data across every
  // panel this page reads — not just "no unbilled trips", which a
  // pilot with a month of paid-off history also sees. Used here only as
  // the "this screen looks blank" signal for the notice below; the
  // getting-started panel itself is gated on its own counts.
  const isDayOne =
    readyCount === 0 &&
    unmarkedTripCount === 0 &&
    clients.length === 0 &&
    expenses.length === 0 &&
    liveInvoices.length === 0 &&
    yearPayments.length === 0;

  // The panel is for a pilot who has not yet billed anything: it goes the
  // moment there is a trip or an invoice on file, whether or not the last
  // two steps were ever ticked. Gated on all three counts having actually
  // been read — an unticked box drawn from a failed count would be the
  // "you have none of these" lie in checkbox form.
  const onboardingCountsOk = anyClientCount.ok && anyTripCount.ok && anyInvoiceCount.ok;
  const showGettingStarted =
    onboardingCountsOk && anyTripCount.count === 0 && anyInvoiceCount.count === 0;

  // Each step's done-state is a fact about the account, not a stored
  // "progress" flag: a client row exists, a trip row exists, an invoice
  // row exists, the account carries a Stripe Connect id. Steps 2 and 3
  // are structurally false while this panel is on screen — that is the
  // same fact that keeps it on screen — but they are read rather than
  // hardcoded so the panel cannot drift from the condition that shows it.
  const GETTING_STARTED_STEPS = [
    {
      id: "client",
      label: "Add your first client",
      detail: "The owner, operator, or management company you fly for. Trips and invoices both hang off a client.",
      href: "/clients/new",
      cta: "Add a client",
      done: anyClientCount.ok && anyClientCount.count > 0,
    },
    {
      id: "trip",
      label: "Log your first trip",
      detail: "Dates, tail number, day rate. Its legs feed your logbook and its days feed the invoice.",
      href: "/trips/new",
      cta: "Log a trip",
      done: anyTripCount.ok && anyTripCount.count > 0,
    },
    {
      id: "invoice",
      label: "Turn it into an invoice",
      detail: "Flight days, travel days, and rebilled expenses come across from the trip. You review before anything is sent.",
      href: "/invoices/new",
      cta: "Draft an invoice",
      done: anyInvoiceCount.ok && anyInvoiceCount.count > 0,
    },
    {
      id: "stripe",
      label: "Connect Stripe to get paid",
      detail: "Optional, and it only affects how a client can pay you. Invoices work without it.",
      href: "/settings",
      cta: "Open settings",
      done: Boolean(account.connect_account_id),
    },
  ];
  const stepsDone = GETTING_STARTED_STEPS.filter((s) => s.done).length;

  return (
    // LPageShell owns the root wrapper's exit from INSTRUMENT type
    // (font-ledger, Ledger's body scale, Ledger's ink token) and the
    // title/subtitle/action header this screen used to hand-roll — see
    // components/ledger/page-shell.tsx's header for why the contract screen
    // now composes through it instead of keeping its own copy. The shell
    // around this slot still paints INSTRUMENT's canvas — that swap is a
    // later migration phase (see this file's task header) — so this
    // subtree's own cards carry the Ledger look on whatever ground sits
    // behind them.
    <LPageShell
      title="Overview"
      subtitle={
        errors.length
          ? "Some figures below couldn't load. See the notice."
          : `${pluralize(readyCount, "trip")} flown and logged but not yet invoiced. ${
              overdue.length
                ? `${pluralize(overdue.length, "invoice")} past due.`
                : "No invoices past due."
            }${
              unmarkedTripCount
                ? ` ${pluralize(unmarkedTripCount, "trip")} still marked Scheduled. Mark them flown to invoice them.`
                : ""
            }`
      }
      action={
        <>
          <NextLink href="/trips/new" className={lButtonClass({ variant: "outline" })}>
            Log a trip
          </NextLink>
          {/* THE ONE FILLED ACCENT BUTTON on this screen — every other
              action, including the per-row "Draft invoice" buttons below,
              is outline or quiet. */}
          <NextLink href="/invoices/new" className={lButtonClass({ variant: "primary" })}>
            Create invoice
          </NextLink>
        </>
      }
    >
      {errors.length > 0 ? (
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>
            {`Couldn't load: ${errors.map((e) => e.context).join(", ")}. `}
            {friendlyDbError(errors[0]?.error, "overview")}
          </span>
        </LAlert>
      ) : null}

      {truncatedAggregates.length > 0 ? (
        <LAlert tone="warn" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            {`Figures using ${truncatedAggregates.join(
              ", "
            )} may be partial: there are more than ${AGGREGATE_LIMIT} rows and only the first ${AGGREGATE_LIMIT} were totaled.`}
          </span>
        </LAlert>
      ) : null}

      {/* NEEDS ATTENTION — promoted to a full-width card directly under the
          error notices, ahead of getting-started and the KPI row. This
          panel carries lapsed 135.293/.297/.299 operator qualifications and
          overdue invoices — the one item on this page a false "all clear"
          is most expensive to believe — and it used to render last,
          bottom-right of a 2-up grid, several scrolls down on a laptop and
          worse on a phone where that grid single-columns. Nothing about
          the panel's own logic changed below: same NEEDS_ATTENTION
          ordering, same item renderers, same links.

          Rendered ONLY when there is something to show: an error (which
          must be surfaced regardless of attentionCount, since a failed
          read is never "nothing needs attention") or a real item. A
          healthy account with attentionCount === 0 gets no card here at
          all — an empty "all clear" ahead of everything else would be the
          same reassuring-zero this file's other comments warn against,
          just moved to the top of the page instead of the bottom.

          A subtle crit left edge, not a loud banner — this is a working
          tool a pilot opens every day, and NEEDS_ATTENTION.length can be
          entirely W-9 paperwork with nothing urgent in it. */}
      {errors.length > 0 || NEEDS_ATTENTION.length > 0 ? (
        <LCard className="border-l-2 border-l-crit">
          <div className="mb-3 flex flex-col gap-1">
            <h2 className="text-h3 font-semibold">Needs attention</h2>
            <p className="text-body-s text-ink-3">{pluralize(attentionCount, "item")}</p>
          </div>

          {/* U1: a failed read is not "nothing needs attention". The card
              above is gated to render for exactly this case even though
              NEEDS_ATTENTION itself may be empty — see that gate's
              comment. */}
          {errors.length ? (
            <div className="flex items-center justify-center py-5">
              <p className="text-center text-body-s text-ink-3">
                Couldn&rsquo;t load. See the notice above. This is not a
                statement that nothing needs attention.
              </p>
            </div>
          ) : (
            // A real ordered list, not a stack of rows. The order IS the
            // information here — qualifications, then overdue invoices,
            // then the reserved unassigned-receipts slot, then W-9s (see
            // the slot arithmetic above) — and an <ol> is what tells a
            // screen reader "this is 1 of 6, in priority order" instead of
            // presenting six unrelated panels.
            <ol className="m-0 list-none divide-y divide-hair p-0">
              {NEEDS_ATTENTION.map((item, index) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tnum-l text-caption text-ink-3" aria-hidden>
                        {index + 1}
                      </span>
                      <LPill tone={item.tone}>{item.band}</LPill>
                      <span className="font-medium">{item.label}</span>
                    </div>
                    <span className="text-caption text-ink-3">{item.detail}</span>
                  </div>
                  <NextLink
                    href={item.href}
                    aria-label={`${item.action}, ${item.label}`}
                    className={lButtonClass({ variant: "outline", size: "sm" })}
                  >
                    {item.action}
                  </NextLink>
                </li>
              ))}
            </ol>
          )}
          {attentionMoreCount > 0 ? (
            <p className="mt-2 text-caption text-ink-3">{`+${attentionMoreCount} more`}</p>
          ) : null}
        </LCard>
      ) : null}

      {/* Day-one orientation — the KPI cards below are correctly $0.00
          with nothing logged, but a zero-state dashboard alone doesn't
          say what to do next. Said once here, since this is the screen
          every other one is reached from. */}
      {showGettingStarted ? (
        <LCard>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1">
              <h2 className="text-h3 font-semibold">Getting started</h2>
              {/* "Start with a client", matching step 1 of the list this
                  sentence sits beside — it used to say "Start with a trip",
                  and a clientless trip saves fine but can never be invoiced
                  (invoice_lines_validate_trip), so the page's own words
                  steered a first session into the one dead end. */}
              <p className="text-body-s text-ink-3">
                {`${stepsDone} of ${GETTING_STARTED_STEPS.length} done. Start with a client. The figures below fill in from there.`}
              </p>
            </div>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {GETTING_STARTED_STEPS.map((step, index) => (
                <li
                  key={step.id}
                  className="flex flex-wrap items-start justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    {step.done ? (
                      <CheckCircleIcon className="mt-0.5 shrink-0 text-good" />
                    ) : (
                      <CircleIcon className="mt-0.5 shrink-0 text-ink-3" />
                    )}
                    <div className="flex flex-col gap-1">
                      <div className="text-body-s">
                        <span className="font-medium">{`${index + 1}. ${step.label}`}</span>
                        <span
                          className={cn(
                            "text-caption",
                            step.done ? "text-good" : "text-ink-3"
                          )}
                        >
                          {step.done ? " · Done" : " · Not done yet"}
                        </span>
                      </div>
                      <p className="text-caption text-ink-3">{step.detail}</p>
                    </div>
                  </div>
                  {/* Outline, not filled — "Create invoice" above is the
                      one accent button on this screen; a not-done step is
                      distinguished by its icon and copy, not by a second
                      filled button competing with it. */}
                  <NextLink
                    href={step.href}
                    aria-label={`${step.done ? "Review" : step.cta}, step ${index + 1}, ${step.label}`}
                    className={lButtonClass({ variant: "outline", size: "sm" })}
                  >
                    {step.done ? "Review" : step.cta}
                  </NextLink>
                </li>
              ))}
            </ol>
          </div>
        </LCard>
      ) : !onboardingCountsOk && isDayOne && !errors.length ? (
        // A failed count is not "you haven't started". With nothing else
        // on this screen to look at either, say which of the two it is
        // rather than leaving a pilot with four $0.00 cards and no
        // explanation at all.
        <LAlert tone="warn" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            {`We couldn't check how far along your setup is (${onboardingErrors
              .map((e) => e.context)
              .join(", ")}), so the getting-started steps aren't shown. This is not a statement that you haven't started.`}
          </span>
        </LAlert>
      ) : null}

      {/* Row 1 — the money, in two named groups rather than one flat row
          of four identical cards. See KPI_GROUPS above for the reasoning;
          every figure keeps the single source it already had. Each group
          is one LCard, its KPIs rendered as LStat figures in a row — the
          Ledger shape for "several related numbers, one card". */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {KPI_GROUPS.map((group) => (
          <section key={group.id} aria-label={group.label}>
            <LCard className="flex h-full flex-col gap-4">
              <p className="text-caption font-semibold text-ink-3">{group.label}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {KPIS.filter((kpi) => kpi.group === group.id).map((kpi) => (
                  // The whole stat is the link. A figure a pilot can't
                  // follow to the records behind it is a poster, not a
                  // dashboard — and the destination is always the screen
                  // that owns that number's source.
                  <NextLink
                    key={kpi.id}
                    href={kpi.href}
                    className="-m-2 flex flex-col gap-1 rounded-control p-2 transition-colors hover:bg-sunk"
                  >
                    <LStat label={kpi.label} figure={kpi.value} sub={kpi.sub} />
                    <p className="text-caption text-ink-3">
                      {moneyOk ? kpi.hint : "This is not a statement that it is zero."}
                    </p>
                  </NextLink>
                ))}
              </div>
            </LCard>
          </section>
        ))}
      </div>

      {/* Row 2 — UNBILLED MONEY, BY CLIENT, paired with READY TO INVOICE.
          The lead module: the one question this screen exists to answer is
          "what should I invoice next", and the answer is a client, not a
          total.

          THIS IS NOT A SECOND UNBILLED FIGURE. Every cell below comes from
          pilot.unbilled_by_client, and the "Unbilled work" card above comes
          from pilot.unbilled_summary, which is defined as an aggregate OVER
          pilot.unbilled_by_client. They are the same number; the total row
          at the bottom of this table is where a pilot can see that for
          themselves. See 20260813010000_unbilled_money_reads.sql.

          Placed directly under the money row, and — from md up — paired
          side by side with "Ready to invoice": both are the actionable
          half of "Owed to you", and every row in either card carries the
          one tap that turns it into a draft. This card takes the wider
          track (3fr vs 2fr) because its table carries more columns; below
          md both stack full width, this one first. The document-
          expirations panel, which is informational rather than
          actionable, stays below this pair. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_2fr]">
        <LCard>
          <div className="mb-3 flex flex-col gap-1">
            <h2 className="text-h3 font-semibold">Unbilled money, by client</h2>
            {/* The computed sentence when there is one — the roadmap's own
                "N unbilled trip days and $X in unbilled reimbursables across
                M clients". It is withheld (null) both when nothing is
                unbilled and when the breakdown came back partial, because in
                the second case its client count would be wrong; the standing
                description takes over rather than a half-true figure. */}
            <p className="tnum-l text-body-s text-ink-3">
              {unbilledSentence ??
                "Every completed trip you haven’t invoiced yet, grouped by who you’d bill it to."}
            </p>
          </div>

          {/* A failed read is not "you're caught up" — the single most
              expensive false statement this module could make, since being
              caught up is exactly what a pilot wants to be told. Gated on
              the same page-wide `errors` as every other panel here. */}
          {errors.length ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="text-center text-body-s text-ink-3">
                Couldn&rsquo;t load your unbilled work. See the notice above.
                This is not a statement that you are caught up.
              </p>
            </div>
          ) : readyCount === 0 && showGettingStarted ? (
            // FIRST RUN. "You're caught up" and "every completed trip on file
            // has been invoiced" are both TRUE on an account with no trips at
            // all — vacuously, which is the kind of true that reads as a lie.
            // The Getting started panel directly above this one is
            // simultaneously saying 0 of 4 steps are done, so the screen would
            // congratulate and nag about the same empty account in adjacent
            // cards, and offer "Log a trip" twice. Gated on the SAME signal
            // that panel is gated on (no trips, no invoices), so the two
            // cannot get out of step. No CTA here: step 2 up there is the CTA.
            <LEmpty title="Nothing unbilled yet">
              Log a trip and mark it flown; its billable days and rebillable
              receipts appear here, grouped by client.
            </LEmpty>
          ) : readyCount === 0 ? (
            <LEmpty
              title="Nothing unbilled. You’re caught up"
              action={
                <NextLink
                  href="/trips/new"
                  className={lButtonClass({ variant: "outline" })}
                >
                  Log a trip
                </NextLink>
              }
            >
              Every completed trip on file has been invoiced. Mark the next one flown and it shows up here.
            </LEmpty>
          ) : (
            <>
              {/* PHONE LAYOUT — up to md. Not a nicety: a contract pilot reads
                  this between legs, standing in an FBO, and a seven-column
                  table on a ~375px screen shows the Client column and hides
                  the two cells the module exists for — the unbilled amount
                  and the Draft invoice button — behind a horizontal scroll.
                  "What do I bill, for whom, one tap" would degrade to a list
                  of client names.

                  So the phone gets the same three answers stacked, in that
                  order, with the secondary figures on one line beneath — the
                  shape the "Ready to invoice" list already uses on this
                  screen. Both layouts read unbilledDisplayRows, so they cannot
                  disagree; the table below is the md+ view of these same
                  cells. */}
              <div className="md:hidden">
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {unbilledDisplayRows.map((row) => (
                    <li key={row.key} className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col">
                          <span className="font-medium">{row.label}</span>
                          {row.waiting === null ? null : (
                            <span className="tnum-l text-caption text-ink-3">
                              {`Oldest ${pluralize(row.waiting, "day")} ago`}
                            </span>
                          )}
                        </div>
                        <span className="tnum-l font-bold">{row.total}</span>
                      </div>
                      <span className="tnum-l text-caption text-ink-3">
                        {`${pluralize(row.trips, "trip")} · ${row.days} ${
                          row.days === "1" ? "day" : "days"
                        } · ${row.dayMoney} day money · ${
                          row.reimbursables
                        } reimbursables`}
                      </span>
                      <div>
                        <NextLink
                          href={draftHref(row.clientId)}
                          aria-label={`${draftAction(row.clientId)}, ${row.label}`}
                          className={lButtonClass({ variant: "outline", size: "sm" })}
                        >
                          {draftAction(row.clientId)}
                        </NextLink>
                      </div>
                    </li>
                  ))}
                </ul>
                {/* The same reconciliation total the table's <tfoot> carries,
                    in the stacked shape. A pilot who can add the column up on
                    a laptop should be able to on a phone. */}
                <hr className="my-3 border-0 border-t border-hair" />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="font-bold">Total unbilled</span>
                    <span className="tnum-l text-caption text-ink-3">
                      {`${pluralize(readyCount, "trip")} · ${formatDays(
                        Number(unbilledSummary.billable_days)
                      )} days · ${formatCents(
                        Number(unbilledSummary.day_value_cents)
                      )} day money · ${formatCents(
                        Number(unbilledSummary.rebill_expense_cents)
                      )} reimbursables`}
                    </span>
                  </div>
                  <span className="tnum-l font-bold">{formatCents(unbilledCents)}</span>
                </div>
              </div>

              {/* TABLE LAYOUT — md and up, where seven columns fit without a
                  scroll and the column ranking is readable at a glance. */}
              <div className="hidden md:block">
                <LTable>
                  <caption>
                    <span className="sr-only">Unbilled money by client</span>
                  </caption>
                  <thead>
                    <tr>
                      <LTh>Client</LTh>
                      <LTh numeric>Trips</LTh>
                      <LTh numeric>Days</LTh>
                      <LTh numeric>Day money</LTh>
                      <LTh numeric>Reimbursables</LTh>
                      <LTh numeric>Unbilled</LTh>
                      <LTh>
                        <span className="sr-only">Action</span>
                      </LTh>
                    </tr>
                  </thead>
                  <tbody>
                    {unbilledDisplayRows.map((row) => (
                      <tr key={row.key}>
                        <LTd>
                          <div className="flex flex-col">
                            <span className="font-medium">{row.label}</span>
                            {row.waiting === null ? null : (
                              <span className="tnum-l text-caption text-ink-3">
                                {`Oldest ${pluralize(row.waiting, "day")} ago`}
                              </span>
                            )}
                          </div>
                        </LTd>
                        <LTd numeric>{row.trips}</LTd>
                        <LTd numeric>{row.days}</LTd>
                        <LTd numeric>{row.dayMoney}</LTd>
                        <LTd numeric>{row.reimbursables}</LTd>
                        <LTd numeric>
                          <span className="font-bold">{row.total}</span>
                        </LTd>
                        <LTd>
                          {/* One tap into the EXISTING draft flow, which is
                              single-client by construction — which is why a
                              row per client is the right shape and a batch
                              button was never going to be. The no-client
                              bucket goes to /trips instead: there is no
                              client to draft against, and offering the draft
                              flow anyway would open something that cannot
                              include these trips. Outline, not filled — the
                              one accent button on this screen is "Create
                              invoice" in the page header. */}
                          <NextLink
                            href={draftHref(row.clientId)}
                            aria-label={`${draftAction(row.clientId)}, ${row.label}`}
                            className={lButtonClass({ variant: "outline", size: "sm" })}
                          >
                            {draftAction(row.clientId)}
                          </NextLink>
                        </LTd>
                      </tr>
                    ))}
                  </tbody>
                  {/* THE RECONCILIATION ROW, in a real <tfoot>. Not a summary
                      flourish: it is the same figure as the "Unbilled work"
                      card above, from the same derivation chain, printed
                      where a pilot can add the column up and check it.

                      <tfoot> rather than a last row in <tbody> because it IS
                      the table's summary and assistive tech should say so —
                      inside the body it would be announced as just another
                      client, one a screen-reader user would reasonably try
                      to draft an invoice for. */}
                  <tfoot>
                    <tr>
                      <LTd>
                        <span className="font-bold">Total unbilled</span>
                      </LTd>
                      <LTd numeric>
                        <span className="font-bold">{readyCount}</span>
                      </LTd>
                      <LTd numeric>
                        <span className="font-bold">
                          {formatDays(Number(unbilledSummary.billable_days))}
                        </span>
                      </LTd>
                      <LTd numeric>
                        <span className="font-bold">
                          {formatCents(Number(unbilledSummary.day_value_cents))}
                        </span>
                      </LTd>
                      <LTd numeric>
                        <span className="font-bold">
                          {formatCents(Number(unbilledSummary.rebill_expense_cents))}
                        </span>
                      </LTd>
                      <LTd numeric>
                        <span className="font-bold">{formatCents(unbilledCents)}</span>
                      </LTd>
                      <LTd />
                    </tr>
                  </tfoot>
                </LTable>
              </div>

              {/* TWO DIFFERENT THINGS CAN PUT THE ROWS OUT OF STEP WITH THE
                  TOTAL, and they need different sentences — see
                  clientRowsState. A capped row set is a strict shortfall and
                  is named as one. Rows claiming MORE than the total cannot be
                  truncation; it means the three reads saw different instants,
                  and telling that pilot "the client list came back
                  incomplete" would be a false diagnosis attached to
                  arithmetic they can see is impossible ("$900.00 of the
                  $800.00 total"). Said out loud either way rather than left
                  as a silent discrepancy the pilot has to spot. */}
              {unbilledBreakdown === "partial" ? (
                <p className="mt-3 text-caption text-ink-3">
                  {`The rows above account for ${formatCents(
                    unbilledCents - unbilledShortfallCents
                  )} of the ${formatCents(
                    unbilledCents
                  )} total. The client list came back incomplete, so this breakdown is partial in its money, its trip counts and its days alike. The total row is not: it is one read that cannot be shortened.`}
                </p>
              ) : unbilledBreakdown === "inconsistent" ? (
                <p className="mt-3 text-caption text-ink-3">
                  These rows and the total were read a moment apart and
                  don&rsquo;t reconcile. Something changed in between, most
                  likely an invoice issued or voided while this page loaded.
                  Reload to see one consistent picture.
                </p>
              ) : null}

              <div className="mt-3">
                {/* Same discipline as the currency disclaimer two panels
                    down: claim only what the figure is. Day money plus
                    rebillable receipts is what lib/trip-value.ts has always
                    meant by a trip's value, and createInvoiceDraft adds per
                    diem and any contract minimum ON TOP of it — so this is
                    not a prediction of the invoice total, and must not be
                    written as one. */}
                <p className="text-caption text-ink-3">
                  Billable day money plus rebillable receipts for completed
                  trips not yet invoiced: the same figure as &ldquo;Unbilled
                  work&rdquo; above. Per diem and contract minimums are added
                  at drafting, so a draft can come out higher.
                </p>
              </div>
            </>
          )}
        </LCard>

        {/* READY TO INVOICE — paired with the unbilled-by-client table via
            the grid both cards sit in (see that card's opening comment).
            Moved out of the bottom-of-page 2-up grid it used to share with
            "Needs attention", which is now a full-width card near the top
            of the page (see there for why); this panel's own content and
            gating are otherwise unchanged. */}
        <LCard>
          <div className="mb-3 flex flex-col gap-1">
            <h2 className="text-h3 font-semibold">Ready to invoice</h2>
            <p className="text-body-s text-ink-3">{pluralize(readyCount, "trip")}</p>
          </div>

          {/* U1/U2: a failed read must not render as "nothing to bill".
              Narrower than it used to be — the trip rows arrive priced from
              pilot.unbilled_trip_money, so there is no longer a partial
              day-type map this list could quietly misprice a trip from —
              but the gate stays page-wide (see moneyOk above), the same as
              the document-expirations panel. */}
          {errors.length ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="text-center text-body-s text-ink-3">
                Couldn&rsquo;t load your unbilled trips. See the notice
                above. This is not a statement that none are waiting.
              </p>
            </div>
          ) : readyTrips.length === 0 ? (
            <LEmpty
              title="Nothing ready to invoice"
              action={
                <NextLink
                  href="/trips/new"
                  className={lButtonClass({ variant: "outline" })}
                >
                  Log a trip
                </NextLink>
              }
            >
              No completed trips are waiting to be billed.
            </LEmpty>
          ) : (
            <>
              <div className="flex flex-col divide-y divide-hair">
                {readyTrips.map((trip) => (
                  <NextLink
                    key={trip.id}
                    href={`/trips/${trip.id}`}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{trip.client}</span>
                      <span className="text-caption text-ink-3">
                        {/* pluralizeDays, not pluralize: a billable day
                            count is numeric(3,1) per row, so 6.5 is a real
                            answer and "6.5 days" must not become "7
                            days". */}
                        {[trip.route, trip.tail, pluralizeDays(trip.days), trip.dates]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="text-caption text-ink-3">{trip.detail}</span>
                    </div>
                    <span className="tnum-l font-bold">{formatCents(trip.amountCents)}</span>
                  </NextLink>
                ))}
              </div>
              {readyCount > readyTrips.length ? (
                <p className="mt-2 text-caption text-ink-3">{`+${readyCount - readyTrips.length} more`}</p>
              ) : null}
              <div className="mt-3">
                {soleClientId ? (
                  <NextLink
                    href={`/invoices/new?client=${soleClientId}`}
                    className={lButtonClass({ variant: "outline" })}
                  >
                    {`Invoice ${pluralize(readyCount, "trip")}`}
                  </NextLink>
                ) : (
                  // M12: /invoices/new drafts against exactly one client's
                  // trips, so a button offering to "Invoice N trips" here
                  // cannot keep that promise once those N trips span more
                  // than one client — it would have to silently drop most
                  // of them. Relabeled to what it can actually do: open
                  // the drafting flow and let the pilot pick which
                  // client's batch to start.
                  <NextLink
                    href="/invoices/new"
                    className={lButtonClass({ variant: "outline" })}
                  >
                    Start an invoice
                  </NextLink>
                )}
              </div>
            </>
          )}
        </LCard>
      </div>

      {/* Row 3 — document expirations. NOT a currency determination — see
          the query comment above on why this deliberately excludes
          day/night/instrument recency. */}
      <LCard>
        <div className="mb-3 flex flex-col gap-1">
          <h2 className="text-h3 font-semibold">Document expirations</h2>
          <p className="text-body-s text-ink-3">
            Medical, flight review, passport, insurance and PIC proficiency
            check (61.58) dates from your documents
          </p>
        </div>

        {/* U1: a failed read here is not "you have no documents on file" —
            it used to render exactly that, inviting a pilot to re-enter a
            medical or flight-review date the query simply couldn't reach.
            Gated on the same page-wide `errors` this file already builds
            for the banner above (see its own comment) and the day-one
            card below — a query error is not "no data". */}
        {errors.length ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-center text-body-s text-ink-3">
              Couldn&rsquo;t load your document expirations. See the notice
              above. This is not a statement that you have none on file.
            </p>
          </div>
        ) : expirationRows.length === 0 ? (
          <LEmpty
            title="No documents on file"
            action={
              <NextLink
                href="/documents"
                className={lButtonClass({ variant: "outline" })}
              >
                Add your documents
              </NextLink>
            }
          >
            No document dates on file yet.
          </LEmpty>
        ) : (
          <LTable>
            <caption>
              <span className="sr-only">Document expirations</span>
            </caption>
            <thead>
              <tr>
                <LTh>Document</LTh>
                <LTh>Expires</LTh>
                <LTh numeric>Status</LTh>
              </tr>
            </thead>
            <tbody>
              {expirationRows.map((row) => {
                const badge = EXPIRY_LADDER_BADGE[row.ladder_stage] ?? LADDER_FALLBACK;
                return (
                  <tr key={row.source_id}>
                    <LTd>
                      <span className="font-medium">{row.item_label}</span>
                    </LTd>
                    <LTd>
                      <span className="text-ink-3">{formatDate(row.expires_on)}</span>
                    </LTd>
                    <LTd numeric>
                      <LPill tone={ladderToPillTone(badge.tone)}>{badge.label}</LPill>
                    </LTd>
                  </tr>
                );
              })}
            </tbody>
          </LTable>
        )}

        <div className="mt-3">
          {/* Deliberately NOT the currency disclaimer. That copy opens
              "Currency is calculated from the entries you logged", which
              asserts a calculation this product does not yet perform —
              the currency engine is Phase 7 and ships only after an owner
              spec review and counsel sign-off on the wording. Showing it
              here is merely inaccurate today, but it also spends the
              disclaimer early: when the real engine lands,
              CURRENCY_DISCLAIMER travels with IT, verbatim from
              lib/brand.ts. This panel claims only what it is — dates the
              pilot typed off their own documents. */}
          <p className="text-caption text-ink-3">
            These are the expiry dates you recorded on your own documents.
            Keeping them current is your responsibility.
          </p>
        </div>
      </LCard>
    </LPageShell>
  );
}

/* ── Inline icons ──────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Three compact 16px outlines, defined once here rather than
 * per call site, stroke="currentColor" so each inherits its caller's tone
 * utility (text-good, text-ink-3, text-crit, text-warn). */

function CheckCircleIcon({ className }: { className?: string }) {
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
      <path d="M5.25 8.25 7.25 10.25 10.75 6" />
    </svg>
  );
}

function CircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="6.25" />
    </svg>
  );
}

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
