import NextLink from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Table,
  Text,
  VisuallyHidden,
} from "@/components/ui";
import {
  CheckCircledIcon,
  CircleIcon,
  ExclamationTriangleIcon,
} from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { countOf } from "@/lib/supabase/rows";
import { DASHBOARD_PATH } from "@/lib/nav";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { tripValueCents, type TripDayValueRow } from "@/lib/trip-value";
import { STAT_ROW_LAYOUT } from "@/components/ui/skeletons";
import { EXPIRY_LADDER_BADGE, type ExpiryBadge } from "../documents/expiry-badge";
import PageShell from "../page-shell";

export const metadata = { title: "Overview" };

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Row shapes for the boundary cast. `.select()` against database.types.ts
// resolves to `never` (see lib/supabase/account.ts's comment on the same
// issue), so every query result is reasserted to its real row type here,
// once, at the point it crosses from Supabase into this component.
// ---------------------------------------------------------------------------
type UnbilledTripRow = {
  id: string;
  client_id: string | null;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  day_rate_cents: number;
  day_count: number;
  travel_day_count: number | null;
  travel_day_rate_cents: number | null;
};

type ClientRow = {
  id: string;
  name: string;
  w9_status: "not_requested" | "requested" | "on_file";
  w9_sent_at: string | null;
  archived_at: string | null;
};

type ExpenseRow = {
  id: string;
  trip_id: string | null;
  treatment: "rebill" | "deduct" | "unassigned";
  amount_cents: number;
  /**
   * The date the cost was incurred. Read even though the query is NOT
   * date-filtered, because this one read feeds figures at two different
   * scopes: rebillByTrip prices trips of any age (a trip started in
   * December and invoiced in January must keep its receipts), while the
   * deductible KPI sits under a "This calendar year" heading and must be
   * cut to that year in JS. Filtering the query itself would silently
   * under-price last year's unbilled trips.
   */
  incurred_on: string;
};

type LiveInvoiceRow = {
  id: string;
  client_id: string;
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
  client_id: string;
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
// app/(app)/documents/expiry-badge.ts, whose tones ARE Radix Badge colours
// — so there is nothing to translate here. That file's header explains why
// it must stay the only definition.
const LADDER_FALLBACK: ExpiryBadge = { tone: "gray", label: "—" };

const READY_TO_INVOICE_LIMIT = 6;
const NEEDS_ATTENTION_LIMIT = 8;
const EXPIRATIONS_LIMIT = 6;

// Bound for the in-JS aggregate reads below (clients, expenses,
// invoice_payments) — see the query comments for why this must be
// explicit rather than left to the Data API's own silent cap.
const AGGREGATE_LIMIT = 1000;

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
    tripsRes,
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
    supabase
      .from("trips")
      .select(
        "id, client_id, starts_on, ends_on, aircraft_ident, day_rate_cents, day_count, travel_day_count, travel_day_rate_cents"
      )
      .eq("status", "completed")
      .eq("billing_state", "unbilled")
      .order("starts_on", { ascending: true }),
    // .limit(1000): Supabase's Data API caps rows (commonly 1000) and
    // TRUNCATES SILENTLY on a plain select — no error, just a shorter
    // array, so a summed KPI from a truncated read would be silently
    // wrong. The limit is explicit here so truncation is DETECTABLE
    // (rows.length === the limit) rather than invisible; see the
    // AGGREGATE_LIMIT truncation check below. The real fix is a
    // server-side aggregate (an RPC or a view) — deferred to a later pass.
    supabase
      .from("clients")
      .select("id, name, w9_status, w9_sent_at, archived_at")
      .limit(AGGREGATE_LIMIT),
    supabase
      .from("expenses")
      .select("id, trip_id, treatment, amount_cents, incurred_on")
      .limit(AGGREGATE_LIMIT),
    // "Awaiting payment" per the spec is issued invoices (sent, or sent
    // with a partial payment already applied) — 'draft' has nothing billed
    // yet and 'paid'/'void' owe nothing, per invoices_protect_issued's own
    // state machine.
    supabase
      .from("invoices")
      .select("id, client_id, invoice_number, due_on")
      .in("status", ["sent", "partial"]),
    supabase.from("invoices_overdue").select("invoice_id, due_on, days_overdue"),
    supabase
      .from("invoice_payments")
      .select("invoice_id, amount_cents, paid_on")
      .gte("paid_on", yearStart)
      .limit(AGGREGATE_LIMIT),
    // Document expiries ONLY — medical, flight review, passport. The
    // currency engine (day/night/instrument recency computed from logbook
    // legs) is Phase 7 and is deliberately not built here: it ships behind
    // a flag only after an owner spec review and counsel sign-off on its
    // own disclaimer. Filtering item_kind keeps this panel honest about
    // what pilot.expirations actually gives it for the OTHER document
    // kinds it also carries (certificate, insurance, w9, other).
    supabase
      .from("expirations")
      .select("source_id, item_kind, item_label, expires_on, days_remaining, ladder_stage")
      .in("item_kind", ["medical", "flight_review", "passport"])
      .order("expires_on", { ascending: true }),
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
    supabase.from("invoices").select("id").eq("status", "void"),
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
    supabase
      .from("invoice_reminder_sends")
      .select("invoice_id, rule_key, detail, created_at")
      .eq("outcome", "failed")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const trips = (tripsRes.data ?? []) as UnbilledTripRow[];
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
    detail: string | null;
    created_at: string;
  }[];
  const unmarkedTripCount = unmarkedTripsRes.count ?? 0;
  const voidInvoiceIds = new Set(
    ((voidInvoicesRes.data ?? []) as { id: string }[]).map((i) => i.id)
  );

  // Hitting the limit exactly is the only client-visible signal that a
  // read was truncated (the Data API returns 200, not an error) — a
  // pilot with 1,400 expenses must see a caveat, not a deductible total
  // silently summed from an arbitrary 1,000 of them.
  const truncatedAggregates = [
    { context: "clients", hit: clients.length === AGGREGATE_LIMIT },
    { context: "expenses", hit: expenses.length === AGGREGATE_LIMIT },
    { context: "payments", hit: payments.length === AGGREGATE_LIMIT },
  ]
    .filter((t) => t.hit)
    .map((t) => t.context);

  // ---------------------------------------------------------------------
  // Phase 2 — depends on the trip ids / invoice ids resolved above.
  // ---------------------------------------------------------------------
  const tripIds = trips.map((t) => t.id);
  // pilot.invoices_overdue is itself filtered to status in ('sent',
  // 'partial'), so every overdue invoice_id is already a member of
  // liveInvoices — one balance-due lookup covers both.
  const balanceIds = liveInvoices.map((i) => i.id);
  // pilot.expirations' source_id for an operator_qualification row is the
  // qualification row's own id, not the client id the "Open client" link
  // needs — resolved with a second, dependent lookup.
  const operatorQualIds = operatorQualExpirations.map((e) => e.source_id);

  const [legsRes, totalsRes, dayRowsRes, dayTypesRes, operatorQualClientsRes] = await Promise.all([
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
    // H6: the same F3 day-rows-aware pricing trips/page.tsx uses — pulled
    // in here too so this screen's "Ready to invoice" figures can never
    // disagree with Trips' or with what createInvoiceDraft actually bills.
    // See lib/trip-value.ts's own comment for the shared contract.
    tripIds.length
      ? supabase
          .from("trip_days")
          .select("trip_id, day_type_id, rate_cents, quantity, units")
          .in("trip_id", tripIds)
      : Promise.resolve({ data: [] as (TripDayValueRow & { trip_id: string })[], error: null }),
    supabase.from("day_types").select("id, billable"),
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
    { context: "unbilled trips", error: tripsRes.error },
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
    { context: "trip day grids", error: dayRowsRes.error },
    { context: "day types", error: dayTypesRes.error },
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
  const rebillByTrip = new Map<string, number>();
  for (const e of expenses) {
    if (e.treatment === "rebill" && e.trip_id) {
      rebillByTrip.set(e.trip_id, (rebillByTrip.get(e.trip_id) ?? 0) + e.amount_cents);
    }
  }
  const legsByTrip = new Map<string, LegRow[]>();
  for (const leg of legs) {
    const list = legsByTrip.get(leg.trip_id) ?? [];
    list.push(leg);
    legsByTrip.set(leg.trip_id, list);
  }
  const dayRowsByTrip = new Map<string, TripDayValueRow[]>();
  for (const row of (dayRowsRes.data ?? []) as (TripDayValueRow & { trip_id: string })[]) {
    const forTrip = dayRowsByTrip.get(row.trip_id) ?? [];
    forTrip.push(row);
    dayRowsByTrip.set(row.trip_id, forTrip);
  }
  const billableByDayType = new Map<string, boolean>(
    ((dayTypesRes.data ?? []) as { id: string; billable: boolean }[]).map((t) => [
      t.id,
      t.billable,
    ])
  );

  // KPI 1 — unbilled work. Day-rate + travel-day value PLUS the rebillable
  // expenses attached to those trips, because that is what the invoice
  // will actually total: createInvoiceDraft emits a reimbursable_expense
  // line for every treatment='rebill' receipt on the trip.
  //
  // Counting only the rate here was a real defect: the KPI card and the
  // "Ready to invoice" list directly beneath it — which has always shown
  // rate + expenses — printed different numbers for the same trips, and
  // the KPI was the one that disagreed with the money the pilot bills.
  // Three figures on one screen, two definitions.
  const unbilledCents = trips.reduce(
    (sum, t) =>
      sum +
      tripValueCents(t, dayRowsByTrip.get(t.id), billableByDayType) +
      (rebillByTrip.get(t.id) ?? 0),
    0
  );
  // "Oldest" is the MAX elapsed time since any unbilled trip ended, not
  // trips[0]'s — trips is ordered by starts_on, so trips[0] is the
  // earliest-STARTING trip, and a later-starting trip that ended sooner
  // could still have a smaller ends_on gap. Picking trips[0] and measuring
  // from its ends_on silently understates how stale the oldest unbilled
  // work actually is.
  const oldestTripDays = trips.reduce((max, t) => {
    const days = Math.floor(
      (Date.now() - Date.parse(`${t.ends_on}T00:00:00Z`)) / 86_400_000
    );
    return Math.max(max, days);
  }, 0);

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
  // because the same `expenses` read also prices unbilled trips of any
  // age through rebillByTrip — see ExpenseRow.incurred_on. Same year
  // boundary as the payments read (`yearStart`), so the two figures in
  // the group agree about what "this year" means.
  const deductibleExpenses = expenses.filter(
    (e) => e.treatment === "deduct" && e.incurred_on >= yearStart
  );
  const deductibleCents = deductibleExpenses.reduce((sum, e) => sum + e.amount_cents, 0);

  // THE RULE: a query error is not "no data" — see the block comment above
  // `errors`. Every KPI below is a sum over at least one of the reads in
  // that array (day types and trip day grids feed unbilledCents via
  // tripValueCents; invoice balances/live invoices feed awaitingCents;
  // payments/void invoices feed paidCents; expenses feeds deductibleCents),
  // so any read failing means every one of these four sums is potentially
  // built on a partial or empty input. Rather than track which specific
  // combination of the fourteen reads above happens to back each card —
  // fragile, and wrong the next time a query is added to Phase 1 above
  // this without its dependants being re-audited — a failure ANYWHERE on
  // this page holds back the concrete figure on ALL four. This is exactly
  // the U2 defect (a failed day_types read prints "$0.00" of real billable
  // work) and it is not unique to that one card: an awaitingCents built
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
   *                        screen. Rendered a size larger.
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
        : trips.length
          ? `${pluralize(trips.length, "trip")} · oldest ${pluralize(oldestTripDays, "day")}`
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
    {
      id: "owed" as const,
      label: "Owed to you",
      // The live pair carries the bigger type. One step, not three — this
      // is a working tool, and a hero number would push the second pair
      // off the fold on a phone.
      size: "7" as const,
    },
    { id: "year" as const, label: `This calendar year`, size: "6" as const },
  ];

  // Ready to invoice — client, route, tail number, day count, dates, and a
  // rate-plus-expenses split, so the figure on this card is traceable to
  // the same two numbers the eventual invoice line items will show.
  const readyTrips = trips.slice(0, READY_TO_INVOICE_LIMIT).map((trip) => {
    const rateCents = tripValueCents(trip, dayRowsByTrip.get(trip.id), billableByDayType);
    const expenseCents = rebillByTrip.get(trip.id) ?? 0;
    const days =
      Number(trip.day_count) +
      (trip.travel_day_count ? Number(trip.travel_day_count) : 0);
    return {
      id: trip.id,
      client: trip.client_id ? clientName.get(trip.client_id) ?? "Unknown client" : "No client",
      route: buildRoute(legsByTrip.get(trip.id) ?? []),
      tail: trip.aircraft_ident,
      dates: formatDateRange(trip.starts_on, trip.ends_on),
      days,
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
  const unbilledClientIds = new Set(
    trips.map((t) => t.client_id).filter((id): id is string => Boolean(id))
  );
  const soleClientId = unbilledClientIds.size === 1 ? [...unbilledClientIds][0] : null;

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
      // it from position. Colour follows the same judgement.
      band: "Invoice" as const,
      tone: "amber" as const,
      label: `${invoice?.invoice_number ?? "Invoice"} past due`,
      detail: `${
        invoice?.client_id ? clientName.get(invoice.client_id) ?? "Unknown client" : "Unknown client"
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
  // operatorQualClientId resolved in Phase 2. A row whose client lookup
  // came back empty (shouldn't happen — the FK is NOT NULL — but a
  // partial/truncated read is still possible) is dropped rather than
  // linked to nothing.
  const operatorQualItemsAll = operatorQualExpirations.flatMap((row) => {
    const clientId = operatorQualClientId.get(row.source_id);
    if (!clientId) return [];
    return [
      {
        id: `operator-qual-${row.source_id}`,
        // Red, and first. A lapsed 135.293/.297/.299 check is the ability
        // to fly for that operator at all — a harder stop than money.
        band: "Qualification" as const,
        tone: "red" as const,
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
        // Red: a chase the pilot believes is happening and is not.
        tone: "red" as const,
        label: `Reminder didn't send · ${invoice.invoice_number ?? "Invoice"}`,
        detail: `${
          invoice.client_id ? clientName.get(invoice.client_id) ?? "Unknown client" : "Unknown client"
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
          tone: "amber" as const,
          label: `${pluralize(unassignedCount, "receipt")} unassigned`,
          detail: "Won't be billed or deducted",
          action: "Sort",
          href: "/expenses",
        },
      ]
    : [];

  const w9Clients = clients.filter((c) => !c.archived_at && c.w9_status !== "on_file");
  const w9ItemsAll = w9Clients.map((c) => ({
    id: `w9-${c.id}`,
    band: "Paperwork" as const,
    tone: "gray" as const,
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

  const readyCount = trips.length;

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
      detail: "Flight days, travel days, and rebilled expenses come across from the trip — you review before anything is sent.",
      href: "/invoices/new",
      cta: "Draft an invoice",
      done: anyInvoiceCount.ok && anyInvoiceCount.count > 0,
    },
    {
      id: "stripe",
      label: "Connect Stripe to get paid",
      detail: "Optional, and it only affects how a client can pay you — invoices work without it.",
      href: "/settings",
      cta: "Open settings",
      done: Boolean(account.connect_account_id),
    },
  ];
  const stepsDone = GETTING_STARTED_STEPS.filter((s) => s.done).length;

  return (
    <PageShell
      title="Overview"
      subtitle={
        errors.length
          ? "Some figures below couldn't load — see the notice."
          : `${pluralize(readyCount, "trip")} flown and logged but not yet invoiced. ${
              overdue.length
                ? `${pluralize(overdue.length, "invoice")} past due.`
                : "No invoices past due."
            }${
              unmarkedTripCount
                ? ` ${pluralize(unmarkedTripCount, "trip")} still marked Scheduled — mark them flown to invoice them.`
                : ""
            }`
      }
      action={
        <Flex gap="3">
          <Button asChild variant="outline">
            <NextLink href="/trips/new">Log a trip</NextLink>
          </Button>
          <Button asChild>
            <NextLink href="/invoices/new">Create invoice</NextLink>
          </Button>
        </Flex>
      }
    >
      {errors.length > 0 ? (
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            {`Couldn't load: ${errors.map((e) => e.context).join(", ")}. `}
            {friendlyDbError(errors[0]?.error, "overview")}
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {truncatedAggregates.length > 0 ? (
        <Callout.Root color="amber">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            {`Figures using ${truncatedAggregates.join(
              ", "
            )} may be partial — there are more than ${AGGREGATE_LIMIT} rows and only the first ${AGGREGATE_LIMIT} were totaled.`}
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {/* Day-one orientation — the KPI cards below are correctly $0.00
          with nothing logged, but a zero-state dashboard alone doesn't
          say what to do next. Said once here, since this is the screen
          every other one is reached from. */}
      {showGettingStarted ? (
        <Card>
          <Flex direction="column" gap="3" py="2">
            <Flex direction="column" gap="1">
              <Text size="4" weight="medium">
                Getting started
              </Text>
              <Text size="2" color="gray">
                {`${stepsDone} of ${GETTING_STARTED_STEPS.length} done. Log the trip once — its legs feed your logbook, its days feed the invoice, and its expenses file themselves against it. The figures below fill in from there.`}
              </Text>
            </Flex>
            {/* The list reset is written out because Radix's is
                class-scoped (`.rt-reset:where(ol, ul)`) and `asChild`
                merges only `rt-Flex` onto the child — so without this the
                UA sheet's 40px inline padding and 1em block margin stay,
                and the rows sit indented inside an empty marker gutter
                while everything else in the Card is flush. Same shape as
                expenses/unassigned-queue.tsx and trips/leg-editor.tsx. */}
            <Flex
              direction="column"
              gap="3"
              asChild
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              <ol>
                {GETTING_STARTED_STEPS.map((step, index) => (
                  <Flex key={step.id} asChild gap="3" align="start" justify="between" wrap="wrap">
                    <li>
                      <Flex gap="3" align="start">
                        <Text color={step.done ? "green" : "gray"} aria-hidden>
                          {step.done ? <CheckCircledIcon /> : <CircleIcon />}
                        </Text>
                        <Flex direction="column" gap="1">
                          <Text size="2" weight="medium">
                            {`${index + 1}. ${step.label}`}
                            <Text as="span" size="1" color={step.done ? "green" : "gray"}>
                              {step.done ? " · Done" : " · Not done yet"}
                            </Text>
                          </Text>
                          <Text size="1" color="gray">
                            {step.detail}
                          </Text>
                        </Flex>
                      </Flex>
                      <Button
                        asChild
                        size="1"
                        variant={step.done ? "outline" : "solid"}
                        aria-label={`${step.cta} — step ${index + 1}, ${step.label}`}
                      >
                        <NextLink href={step.href}>{step.done ? "Review" : step.cta}</NextLink>
                      </Button>
                    </li>
                  </Flex>
                ))}
              </ol>
            </Flex>
          </Flex>
        </Card>
      ) : !onboardingCountsOk && isDayOne && !errors.length ? (
        // A failed count is not "you haven't started". With nothing else
        // on this screen to look at either, say which of the two it is
        // rather than leaving a pilot with four $0.00 cards and no
        // explanation at all.
        <Callout.Root color="amber">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            {`We couldn't check how far along your setup is (${onboardingErrors
              .map((e) => e.context)
              .join(", ")}), so the getting-started steps aren't shown. This is not a statement that you haven't started.`}
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {/* Row 1 — the money, in two named groups rather than one flat row
          of four identical cards. See KPI_GROUPS above for the reasoning;
          every figure keeps the single source it already had.

          The breakpoints and gaps come from STAT_ROW_LAYOUT, which
          components/ui/skeletons.tsx's StatRowSkeleton reads too — the
          loading shape and the real shape are one definition, so the next
          change to this row cannot leave the skeleton behind and reflow
          the whole page on hydration. */}
      <Grid columns={STAT_ROW_LAYOUT.groups} gap={STAT_ROW_LAYOUT.groupGap}>
        {KPI_GROUPS.map((group) => (
          <Flex key={group.id} direction="column" gap="2" asChild>
            <section aria-label={group.label}>
              <Text size="1" color="gray" weight="medium">
                {group.label}
              </Text>
              <Grid columns={STAT_ROW_LAYOUT.cards} gap={STAT_ROW_LAYOUT.cardGap}>
                {KPIS.filter((kpi) => kpi.group === group.id).map((kpi) => (
                  <Card key={kpi.id} asChild>
                    {/* The whole card is the link. A figure a pilot can't
                        follow to the records behind it is a poster, not a
                        dashboard — and the destination is always the
                        screen that owns that number's source. */}
                    <NextLink
                      href={kpi.href}
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      <Flex direction="column" gap="1">
                        <Text size="1" color="gray">
                          {kpi.label}
                        </Text>
                        {/* tabular-nums on every figure on this screen —
                            the .tnum class exists because a column of
                            proportional digits is a legibility bug, and
                            that applies to the counts underneath as much
                            as to the dollars above. */}
                        <Text size={group.size} weight="bold" className="tnum">
                          {kpi.value}
                        </Text>
                        <Text size="1" color="gray" className="tnum">
                          {kpi.sub}
                        </Text>
                        <Text size="1" color="gray">
                          {moneyOk ? kpi.hint : "This is not a statement that it is zero."}
                        </Text>
                      </Flex>
                    </NextLink>
                  </Card>
                ))}
              </Grid>
            </section>
          </Flex>
        ))}
      </Grid>

      {/* Row 2 — document expirations. NOT a currency determination — see
          the query comment above on why this deliberately excludes
          day/night/instrument recency. */}
      <Card>
        <Flex direction="column" gap="1" mb="3">
          <Text size="4" weight="medium">
            Document expirations
          </Text>
          <Text size="2" color="gray">
            Medical, flight review, and passport dates from your documents
          </Text>
        </Flex>

        {/* U1: a failed read here is not "you have no documents on file" —
            it used to render exactly that, inviting a pilot to re-enter a
            medical or flight-review date the query simply couldn't reach.
            Gated on the same page-wide `errors` this file already builds
            for the banner above (see its own comment) and the day-one
            card below — a query error is not "no data". */}
        {errors.length ? (
          <Flex direction="column" align="center" gap="3" py="5">
            <Text size="2" color="gray" align="center">
              Couldn&rsquo;t load your document expirations — see the notice
              above. This is not a statement that you have none on file.
            </Text>
          </Flex>
        ) : expirationRows.length === 0 ? (
          <Flex direction="column" align="center" gap="3" py="5">
            <Text size="2" color="gray">
              No document dates on file yet.
            </Text>
            <Button asChild variant="outline">
              <NextLink href="/documents">Add your documents</NextLink>
            </Button>
          </Flex>
        ) : (
          <Table.Root variant="surface">
            {/* Radix ships VisuallyHidden as a COMPONENT (inline styles),
                never as an `rt-VisuallyHidden` class — that class does not
                exist in its stylesheet, so a caption carrying it rendered
                as a stray centred line of visible text above the table. */}
            <caption>
              <VisuallyHidden>Document expirations</VisuallyHidden>
            </caption>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Document</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Expires</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Status</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {expirationRows.map((row) => {
                const badge = EXPIRY_LADDER_BADGE[row.ladder_stage] ?? LADDER_FALLBACK;
                return (
                  <Table.Row key={row.source_id}>
                    <Table.Cell>
                      <Text weight="medium">{row.item_label}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text color="gray">{formatDate(row.expires_on)}</Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Badge color={badge.tone}>{badge.label}</Badge>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        )}

        <Flex mt="3">
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
          <Text size="1" color="gray">
            These are the expiry dates you recorded on your own documents.
            Keeping them current is your responsibility.
          </Text>
        </Flex>
      </Card>

      {/* Row 3 — ready to invoice / needs attention. */}
      <Grid columns={{ initial: "1", md: "2" }} gap="4">
        <Card>
          <Flex direction="column" gap="1" mb="3">
            <Text size="4" weight="medium">
              Ready to invoice
            </Text>
            <Text size="2" color="gray">
              {pluralize(readyCount, "trip")}
            </Text>
          </Flex>

          {/* U1/U2: a failed read (trips itself, or one of the day-grid /
              day-type reads readyTrips prices off — see moneyOk above)
              must not render as "nothing to bill" or price a trip from a
              partial billableByDayType map. Same page-wide gate as the
              document-expirations panel above. */}
          {errors.length ? (
            <Flex direction="column" align="center" gap="3" py="5">
              <Text size="2" color="gray" align="center">
                Couldn&rsquo;t load your unbilled trips — see the notice
                above. This is not a statement that none are waiting.
              </Text>
            </Flex>
          ) : readyTrips.length === 0 ? (
            <Flex direction="column" align="center" gap="3" py="5">
              <Text size="2" color="gray" align="center">
                No completed trips are waiting to be billed.
              </Text>
              <Button asChild variant="outline">
                <NextLink href="/trips/new">Log a trip</NextLink>
              </Button>
            </Flex>
          ) : (
            <>
              <Flex direction="column">
                {readyTrips.map((trip) => (
                  <NextLink
                    key={trip.id}
                    href={`/trips/${trip.id}`}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <Flex justify="between" align="start" py="2">
                      <Flex direction="column">
                        <Text weight="medium">{trip.client}</Text>
                        <Text size="1" color="gray">
                          {[trip.route, trip.tail, `${pluralize(trip.days, "day")}`, trip.dates]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                        <Text size="1" color="gray">
                          {trip.detail}
                        </Text>
                      </Flex>
                      <Text weight="bold" className="tnum">
                        {formatCents(trip.amountCents)}
                      </Text>
                    </Flex>
                  </NextLink>
                ))}
              </Flex>
              {readyCount > readyTrips.length ? (
                <Text size="1" color="gray">
                  {`+${readyCount - readyTrips.length} more`}
                </Text>
              ) : null}
              <Flex mt="3">
                {soleClientId ? (
                  <Button asChild>
                    <NextLink href={`/invoices/new?client=${soleClientId}`}>
                      {`Invoice ${pluralize(readyCount, "trip")}`}
                    </NextLink>
                  </Button>
                ) : (
                  // M12: /invoices/new drafts against exactly one client's
                  // trips, so a button offering to "Invoice N trips" here
                  // cannot keep that promise once those N trips span more
                  // than one client — it would have to silently drop most
                  // of them. Relabeled to what it can actually do: open
                  // the drafting flow and let the pilot pick which
                  // client's batch to start.
                  <Button asChild variant="outline">
                    <NextLink href="/invoices/new">Start an invoice</NextLink>
                  </Button>
                )}
              </Flex>
            </>
          )}
        </Card>

        <Card>
          <Flex direction="column" gap="1" mb="3">
            <Text size="4" weight="medium">
              Needs attention
            </Text>
            <Text size="2" color="gray">
              {pluralize(attentionCount, "item")}
            </Text>
          </Flex>

          {/* U1: this panel carries lapsed 135.293/.297/.299 operator
              qualifications — the one item on this page a false "all
              clear" is most expensive to believe. Same page-wide gate as
              the two panels above. */}
          {errors.length ? (
            <Flex align="center" justify="center" py="5">
              <Text size="2" color="gray" align="center">
                Couldn&rsquo;t load — see the notice above. This is not a
                statement that nothing needs attention.
              </Text>
            </Flex>
          ) : NEEDS_ATTENTION.length === 0 ? (
            <Flex align="center" justify="center" py="5">
              <Text size="2" color="gray">
                Nothing needs attention right now.
              </Text>
            </Flex>
          ) : (
            // A real ordered list, not a stack of rows. The order IS the
            // information here — qualifications, then overdue invoices,
            // then the reserved unassigned-receipts slot, then W-9s (see
            // the slot arithmetic above) — and an <ol> is what tells a
            // screen reader "this is 1 of 6, in priority order" instead of
            // presenting six unrelated panels.
            // The explicit reset is required — see the getting-started
            // list above for why `asChild` does not bring Radix's with it.
            <Flex
              direction="column"
              asChild
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              <ol>
                {NEEDS_ATTENTION.map((item, index) => (
                  <Flex
                    key={item.id}
                    asChild
                    justify="between"
                    align="center"
                    gap="3"
                    py="2"
                    wrap="wrap"
                  >
                    <li>
                      <Flex direction="column" gap="1" minWidth="0">
                        <Flex align="center" gap="2" wrap="wrap">
                          <Text size="1" color="gray" className="tnum" aria-hidden>
                            {index + 1}
                          </Text>
                          <Badge color={item.tone}>{item.band}</Badge>
                          <Text weight="medium">{item.label}</Text>
                        </Flex>
                        <Text size="1" color="gray" className="tnum">
                          {item.detail}
                        </Text>
                      </Flex>
                      <Button
                        asChild
                        variant="outline"
                        size="1"
                        aria-label={`${item.action} — ${item.label}`}
                      >
                        <NextLink href={item.href}>{item.action}</NextLink>
                      </Button>
                    </li>
                  </Flex>
                ))}
              </ol>
            </Flex>
          )}
          {attentionMoreCount > 0 ? (
            <Text size="1" color="gray">
              {`+${attentionMoreCount} more`}
            </Text>
          ) : null}
        </Card>
      </Grid>
    </PageShell>
  );
}
