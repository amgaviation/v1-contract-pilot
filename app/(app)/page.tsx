import NextLink from "next/link";
import { Badge, Button, Callout, Card, Flex, Grid, Table, Text } from "@radix-ui/themes";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { tripValueCents, type TripDayValueRow } from "@/lib/trip-value";
import { EXPIRY_LADDER_BADGE, type ExpiryBadge } from "./documents/expiry-badge";
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

  const [legsRes, totalsRes, dayRowsRes, dayTypesRes] = await Promise.all([
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
          .select("trip_id, day_type_id, rate_cents, quantity")
          .in("trip_id", tripIds)
      : Promise.resolve({ data: [] as (TripDayValueRow & { trip_id: string })[], error: null }),
    supabase.from("day_types").select("id, billable"),
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
    { context: "trip day grids", error: dayRowsRes.error },
    { context: "day types", error: dayTypesRes.error },
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

      {/* Row 1 — KPI statistics cards. */}
      <Grid columns={{ initial: "1", sm: "2", lg: "4" }} gap="4">
        {KPIS.map((kpi) => (
          <Card key={kpi.id}>
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">
                {kpi.label}
              </Text>
              <Text size="6" weight="bold" className="tnum">
                {kpi.value}
              </Text>
              <Text size="1" color="gray">
                {kpi.sub}
              </Text>
            </Flex>
          </Card>
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

        {expirationRows.length === 0 ? (
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
            <caption className="rt-VisuallyHidden">Document expirations</caption>
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

          {readyTrips.length === 0 ? (
            <Flex align="center" justify="center" py="5">
              <Text size="2" color="gray">
                No completed trips are waiting to be billed.
              </Text>
            </Flex>
          ) : (
            <>
              <Flex direction="column">
                {readyTrips.map((trip) => (
                  <Flex key={trip.id} justify="between" align="start" py="2">
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
                ))}
              </Flex>
              {readyCount > readyTrips.length ? (
                <Text size="1" color="gray">
                  {`+${readyCount - readyTrips.length} more`}
                </Text>
              ) : null}
              <Flex mt="3">
                <Button asChild>
                  <NextLink href="/invoices/new">{`Invoice ${pluralize(readyCount, "trip")}`}</NextLink>
                </Button>
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

          {NEEDS_ATTENTION.length === 0 ? (
            <Flex align="center" justify="center" py="5">
              <Text size="2" color="gray">
                Nothing needs attention right now.
              </Text>
            </Flex>
          ) : (
            <Flex direction="column">
              {NEEDS_ATTENTION.map((item) => (
                <Flex key={item.id} justify="between" align="center" py="2">
                  <Flex direction="column">
                    <Text weight="medium">{item.label}</Text>
                    <Text size="1" color="gray">
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
                </Flex>
              ))}
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
