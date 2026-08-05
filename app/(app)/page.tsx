import NextLink from "next/link";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import MDBadge from "@/components/mdpro/MDBadge";
import ComplexStatisticsCard from "@/components/mdpro/examples/Cards/StatisticsCards/ComplexStatisticsCard";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { EXPIRY_LADDER_BADGE } from "./documents/expiry-badge";
import PageShell from "./page-shell";

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

/**
 * Flight days AND travel days — same rule as app/(app)/trips/page.tsx's
 * tripValueCents. Omitting travel days here would make the Overview screen
 * and the invoice it drafts disagree about what a trip is worth.
 */
function tripValueCents(trip: {
  day_rate_cents: number;
  day_count: number;
  travel_day_rate_cents: number | null;
  travel_day_count: number | null;
}): number {
  return (
    Math.round(trip.day_rate_cents * Number(trip.day_count)) +
    Math.round(
      (trip.travel_day_rate_cents ?? 0) * Number(trip.travel_day_count ?? 0)
    )
  );
}

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

type Badge = { tone: string; label: string };

const LADDER_FALLBACK: Badge = { tone: "secondary", label: "—" };

type KpiCardStyle = { tone: "dark" | "info" | "success" | "primary"; icon: string };
const KPI_CARD_STYLE: Record<string, KpiCardStyle> = {
  unbilled: { tone: "dark", icon: "flight_takeoff" },
  awaiting: { tone: "info", icon: "receipt_long" },
  paid: { tone: "success", icon: "payments" },
  deductible: { tone: "primary", icon: "savings" },
};
const KPI_CARD_FALLBACK: KpiCardStyle = { tone: "info", icon: "insights" };

/**
 * Visually-hidden-but-readable table caption — structural, not a visual
 * token, so it's exempt from the token layer.
 */
const visuallyHiddenSx = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
} as const;

const READY_TO_INVOICE_LIMIT = 6;
const NEEDS_ATTENTION_LIMIT = 8;
const EXPIRATIONS_LIMIT = 6;

// Bound for the in-JS aggregate reads below (clients, expenses,
// invoice_payments) — see the query comments for why this must be
// explicit rather than left to the Data API's own silent cap.
const AGGREGATE_LIMIT = 1000;

export default async function OverviewPage() {
  await requireAccount("/");

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
    voidInvoicesRes,
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
      .select("id, trip_id, treatment, amount_cents")
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
    // invoice_totals/invoice_payments' own comment: amount_paid_cents sums
    // EVERY payment row regardless of the invoice's current status,
    // including 'void' (partial -> void is a legal transition). "Paid this
    // year" must filter those out itself rather than trusting the raw
    // ledger, or a voided invoice's old payment counts as money collected.
    supabase.from("invoices").select("id").eq("status", "void"),
  ]);

  const trips = (tripsRes.data ?? []) as UnbilledTripRow[];
  const clients = (clientsRes.data ?? []) as ClientRow[];
  const expenses = (expensesRes.data ?? []) as ExpenseRow[];
  const liveInvoices = (liveInvoicesRes.data ?? []) as LiveInvoiceRow[];
  const overdue = (overdueRes.data ?? []) as OverdueRow[];
  const payments = (paymentsRes.data ?? []) as PaymentRow[];
  const expirations = (expirationsRes.data ?? []) as ExpirationRow[];
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

  const [legsRes, totalsRes] = await Promise.all([
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
  ]);

  const legs = (legsRes.data ?? []) as LegRow[];
  const totals = (totalsRes.data ?? []) as InvoiceTotalRow[];

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
    { context: "trip routes", error: legsRes.error },
    { context: "invoice balances", error: totalsRes.error },
    { context: "voided invoices", error: voidInvoicesRes.error },
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
    (sum, t) => sum + tripValueCents(t) + (rebillByTrip.get(t.id) ?? 0),
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

  // KPI 4 — deductible expenses: treatment='deduct', full stop.
  const deductibleExpenses = expenses.filter((e) => e.treatment === "deduct");
  const deductibleCents = deductibleExpenses.reduce((sum, e) => sum + e.amount_cents, 0);

  const KPIS = [
    {
      id: "unbilled",
      label: "Unbilled work",
      value: formatCents(unbilledCents),
      sub: trips.length
        ? `${pluralize(trips.length, "trip")} · oldest ${pluralize(oldestTripDays, "day")}`
        : "No unbilled trips",
    },
    {
      id: "awaiting",
      label: "Awaiting payment",
      value: formatCents(awaitingCents),
      sub: liveInvoices.length
        ? pluralize(liveInvoices.length, "invoice")
        : "No invoices outstanding",
    },
    {
      id: "paid",
      label: "Paid this year",
      value: formatCents(paidCents),
      sub: yearPayments.length
        ? pluralize(yearPayments.length, "payment")
        : "No payments recorded this year",
    },
    {
      id: "deductible",
      label: "Deductible expenses",
      value: formatCents(deductibleCents),
      sub: deductibleExpenses.length
        ? `${pluralize(deductibleExpenses.length, "receipt")} filed`
        : "No deductible expenses filed",
    },
  ];

  // Ready to invoice — client, route, tail number, day count, dates, and a
  // rate-plus-expenses split, so the figure on this card is traceable to
  // the same two numbers the eventual invoice line items will show.
  const readyTrips = trips.slice(0, READY_TO_INVOICE_LIMIT).map((trip) => {
    const rateCents = tripValueCents(trip);
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
      label: `${invoice?.invoice_number ?? "Invoice"} past due`,
      detail: `${
        invoice?.client_id ? clientName.get(invoice.client_id) ?? "Unknown client" : "Unknown client"
      } · ${formatCents(balanceByInvoice.get(row.invoice_id) ?? 0)} · ${pluralize(
        row.days_overdue,
        "day"
      )}`,
      action: "Remind",
      href: "/invoices",
    };
  });

  const unassignedCount = expenses.filter((e) => e.treatment === "unassigned").length;
  const unassignedItem = unassignedCount
    ? [
        {
          id: "unassigned-receipts",
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
    label: `W-9 outstanding · ${c.name}`,
    detail:
      c.w9_status === "requested"
        ? `Requested ${formatDate(c.w9_sent_at)}`
        : "Not yet requested",
    // "Open client", not "Request"/"Resend" — this button only navigates
    // to /clients, it doesn't send anything. A verb that performs no
    // action is a defect; label it for what it actually does.
    action: "Open client",
    href: "/clients",
  }));

  const attentionItemsAll = [...overdueItemsAll, ...unassignedItem, ...w9ItemsAll];
  const attentionCount = attentionItemsAll.length;

  // Display list: the unassigned-receipts item gets a slot reserved for it
  // before overdue/W-9 fill the rest, so it can never be starved out by a
  // long overdue list the way the previous concatenate-then-slice did.
  const reservedSlots = unassignedItem.length;
  const remainingSlots = Math.max(0, NEEDS_ATTENTION_LIMIT - reservedSlots);
  const overdueDisplay = overdueItemsAll.slice(0, remainingSlots);
  const w9Display = w9ItemsAll.slice(0, Math.max(0, remainingSlots - overdueDisplay.length));
  const NEEDS_ATTENTION = [...overdueDisplay, ...unassignedItem, ...w9Display];
  const attentionMoreCount = attentionCount - NEEDS_ATTENTION.length;

  const readyCount = trips.length;

  const expirationRows = expirations.slice(0, EXPIRATIONS_LIMIT);

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
            }`
      }
      action={
        <MDBox display="flex" gap={1.5}>
          <MDButton component={NextLink} href="/trips/new" variant="outlined" color="info">
            Log a trip
          </MDButton>
          <MDButton component={NextLink} href="/invoices/new" variant="gradient" color="info">
            Create invoice
          </MDButton>
        </MDBox>
      }
    >
      {errors.length > 0 ? (
        <MDBox mb={3}>
          <Card>
            <MDBox p={3}>
              <MDTypography variant="button" color="error">
                {`Couldn't load: ${errors.map((e) => e.context).join(", ")}. `}
                {friendlyDbError(errors[0]?.error, "overview")}
              </MDTypography>
            </MDBox>
          </Card>
        </MDBox>
      ) : null}

      {truncatedAggregates.length > 0 ? (
        <MDBox mb={3}>
          <Card>
            <MDBox p={3}>
              <MDTypography variant="button" color="warning">
                {`Figures using ${truncatedAggregates.join(
                  ", "
                )} may be partial — there are more than ${AGGREGATE_LIMIT} rows and only the first ${AGGREGATE_LIMIT} were totaled.`}
              </MDTypography>
            </MDBox>
          </Card>
        </MDBox>
      ) : null}

      {/* Row 1 — KPI statistics cards. */}
      <Grid container spacing={3}>
        {KPIS.map((kpi) => {
          const style = KPI_CARD_STYLE[kpi.id] ?? KPI_CARD_FALLBACK;
          return (
            <Grid item xs={12} sm={6} lg={3} key={kpi.id}>
              <MDBox mb={1.5}>
                <ComplexStatisticsCard
                  color={style.tone}
                  icon={style.icon}
                  title={kpi.label}
                  count={kpi.value}
                  percentage={{ color: "secondary", amount: "", label: kpi.sub }}
                />
              </MDBox>
            </Grid>
          );
        })}
      </Grid>

      {/* Row 2 — document expirations. NOT a currency determination — see
          the query comment above on why this deliberately excludes
          day/night/instrument recency. */}
      <MDBox mt={3}>
        <Card>
          <MDBox p={3} pb={0} lineHeight={1.25}>
            <MDTypography variant="h6">Document expirations</MDTypography>
            <MDTypography variant="button" color="text" fontWeight="regular">
              Medical, flight review, and passport dates from your documents
            </MDTypography>
          </MDBox>
          <MDBox p={3} pt={1}>
            {expirationRows.length === 0 ? (
              <MDBox py={3} textAlign="center">
                <MDTypography variant="button" color="text" fontWeight="regular">
                  No document dates on file yet.
                </MDTypography>
                <MDBox mt={2}>
                  <MDButton component={NextLink} href="/documents" variant="outlined" color="info">
                    Add your documents
                  </MDButton>
                </MDBox>
              </MDBox>
            ) : (
              <TableContainer sx={{ boxShadow: "none" }}>
                <Table>
                  <MDBox component="caption" sx={visuallyHiddenSx}>
                    Document expirations
                  </MDBox>
                  <TableHead sx={{ display: "table-header-group" }}>
                    <TableRow>
                      <TableCell>
                        <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                          Document
                        </MDTypography>
                      </TableCell>
                      <TableCell>
                        <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                          Expires
                        </MDTypography>
                      </TableCell>
                      <TableCell align="right">
                        <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                          Status
                        </MDTypography>
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {expirationRows.map((row) => {
                      const badge = EXPIRY_LADDER_BADGE[row.ladder_stage] ?? LADDER_FALLBACK;
                      return (
                        <TableRow key={row.source_id}>
                          <TableCell component="th" scope="row">
                            <MDTypography variant="button" fontWeight="medium">
                              {row.item_label}
                            </MDTypography>
                          </TableCell>
                          <TableCell>
                            <MDTypography variant="button" color="text" fontWeight="regular">
                              {formatDate(row.expires_on)}
                            </MDTypography>
                          </TableCell>
                          <TableCell align="right">
                            <MDBadge
                              variant="gradient"
                              color={badge.tone}
                              badgeContent={badge.label}
                              size="sm"
                              container
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <MDBox mt={2}>
              {/* Deliberately NOT the currency disclaimer. That copy opens
                  "Currency is calculated from the entries you logged",
                  which asserts a calculation this product does not yet
                  perform — the currency engine is Phase 7 and ships only
                  after an owner spec review and counsel sign-off on the
                  wording. Showing it here is merely inaccurate today, but
                  it also spends the disclaimer early: when the real engine
                  lands, CURRENCY_DISCLAIMER travels with IT, verbatim from
                  lib/brand.ts. This panel claims only what it is — dates
                  the pilot typed off their own documents. */}
              <MDTypography variant="caption" color="text">
                These are the expiry dates you recorded on your own
                documents. Keeping them current is your responsibility.
              </MDTypography>
            </MDBox>
          </MDBox>
        </Card>
      </MDBox>

      {/* Row 3 — ready to invoice / needs attention. */}
      <MDBox mt={3}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card sx={{ height: "100%" }}>
              <MDBox p={3} pb={0} lineHeight={1.25}>
                <MDTypography variant="h6">Ready to invoice</MDTypography>
                <MDTypography variant="button" color="text" fontWeight="regular">
                  {pluralize(readyCount, "trip")}
                </MDTypography>
              </MDBox>
              <MDBox p={3} pt={2}>
                {readyTrips.length === 0 ? (
                  <MDBox py={3} textAlign="center">
                    <MDTypography variant="button" color="text" fontWeight="regular">
                      No completed trips are waiting to be billed.
                    </MDTypography>
                  </MDBox>
                ) : (
                  <>
                    {readyTrips.map((trip) => (
                      <MDBox
                        key={trip.id}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="flex-start"
                        py={1.5}
                      >
                        <MDBox lineHeight={1.4}>
                          <MDTypography display="block" variant="button" fontWeight="medium">
                            {trip.client}
                          </MDTypography>
                          <MDTypography display="block" variant="caption" color="text">
                            {[trip.route, trip.tail, `${pluralize(trip.days, "day")}`, trip.dates]
                              .filter(Boolean)
                              .join(" · ")}
                          </MDTypography>
                          <MDTypography display="block" variant="caption" color="text">
                            {trip.detail}
                          </MDTypography>
                        </MDBox>
                        <MDTypography variant="button" fontWeight="bold">
                          {formatCents(trip.amountCents)}
                        </MDTypography>
                      </MDBox>
                    ))}
                    {readyCount > readyTrips.length ? (
                      <MDTypography variant="caption" color="text">
                        {`+${readyCount - readyTrips.length} more`}
                      </MDTypography>
                    ) : null}
                    <MDBox mt={2}>
                      <MDButton component={NextLink} href="/invoices/new" variant="gradient" color="info">
                        {`Invoice ${pluralize(readyCount, "trip")}`}
                      </MDButton>
                    </MDBox>
                  </>
                )}
              </MDBox>
            </Card>
          </Grid>
          <Grid item xs={12} md={6}>
            <Card sx={{ height: "100%" }}>
              <MDBox p={3} pb={0} lineHeight={1.25}>
                <MDTypography variant="h6">Needs attention</MDTypography>
                <MDTypography variant="button" color="text" fontWeight="regular">
                  {pluralize(attentionCount, "item")}
                </MDTypography>
              </MDBox>
              <MDBox p={3} pt={2}>
                {NEEDS_ATTENTION.length === 0 ? (
                  <MDBox py={3} textAlign="center">
                    <MDTypography variant="button" color="text" fontWeight="regular">
                      Nothing needs attention right now.
                    </MDTypography>
                  </MDBox>
                ) : (
                  NEEDS_ATTENTION.map((item) => (
                    <MDBox
                      key={item.id}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                      py={1.5}
                    >
                      <MDBox lineHeight={1.4}>
                        <MDTypography display="block" variant="button" fontWeight="medium">
                          {item.label}
                        </MDTypography>
                        <MDTypography display="block" variant="caption" color="text">
                          {item.detail}
                        </MDTypography>
                      </MDBox>
                      <MDButton
                        component={NextLink}
                        href={item.href}
                        variant="outlined"
                        color="info"
                        size="small"
                        aria-label={`${item.action} — ${item.label}`}
                      >
                        {item.action}
                      </MDButton>
                    </MDBox>
                  ))
                )}
                {attentionMoreCount > 0 ? (
                  <MDTypography variant="caption" color="text">
                    {`+${attentionMoreCount} more`}
                  </MDTypography>
                ) : null}
              </MDBox>
            </Card>
          </Grid>
        </Grid>
      </MDBox>
    </PageShell>
  );
}
