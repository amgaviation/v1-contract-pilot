import { notFound } from "next/navigation";
import NextLink from "next/link";
import { Box, Button, Callout, Card, Flex, Grid, Heading, Text } from "@/components/ui";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { loadFleetOptions } from "@/lib/fleet";
import { loadOptionChoices } from "@/lib/custom-options-read";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import { tripDayQuantity, tripValueCents } from "@/lib/trip-value";
import {
  computeTripSettlement,
  type TripSettlement,
  type TripSettlementInvoiceRow,
  type TripSettlementLineRow,
  type TripSettlementPaymentRow,
} from "@/lib/trip-settlement";
import PageShell from "../../page-shell";
import TripForm, { type ClientOption, type TripFormValues } from "../trip-form";
import LegEditor, { type LegRow } from "../leg-editor";
import DayGrid, {
  type ClientRateOption,
  type DayTypeOption,
  type TripDayRow,
} from "../day-grid";
import { updateTrip } from "../actions";
import DeleteTripButton from "./delete-trip-button";
import MarkFlownButton from "../mark-flown-button";
import SettlementPanel from "./settlement-panel";

export const metadata = { title: "Trip" };

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // gap S: createTrip's redirect appends ?overlap=1 when the new trip's
  // dates intersect an existing one — see findOverlappingTrip in
  // actions.ts. A redirect carries no return value, so this is how the
  // warning survives the hop from create to here. Non-blocking: the trip
  // is already saved by the time this ever renders.
  searchParams: Promise<{ overlap?: string }>;
}) {
  const { id } = await params;
  const { overlap } = await searchParams;
  const { account } = await requireAccount(`/trips/${id}`);

  const supabase = await createClient();
  const [
    { data: tripData, error: tripError },
    { data: legData, error: legError },
    { data: clientData, error: clientError },
    { data: dayTypeData, error: dayTypeError },
    { data: tripDayData, error: tripDayError },
    { data: clientRateData, error: clientRateError },
    { data: committedOn, error: committedError },
    { data: tripLineData, error: tripLineError },
    tripKinds,
  ] = await Promise.all([
    supabase.from("trips").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("trip_legs")
      .select("*")
      .eq("trip_id", id)
      .order("leg_date", { ascending: true }),
    supabase
      .from("clients")
      // cancellation_policy_note (gap S: guided cancellation-fee billing)
      // rides along on this same picker read rather than a second query —
      // it's one more column on a list this page already fetches in full.
      .select(
        "id, name, default_day_rate_cents, default_travel_day_rate_cents, operating_rule, cancellation_policy_note"
      )
      .is("archived_at", null)
      .order("name", { ascending: true }),
    // Every day type, archived included: the grid's <select> only OFFERS
    // the active ones, but an existing trip_days row may point at one a
    // pilot has since archived, and that row still has to render — see
    // day-grid.tsx's optionsFor. `billable` (F2) is what tells the grid
    // when to hide the rate field, and what this page uses (F3) to know
    // which day rows actually count toward the billed total.
    supabase
      .from("day_types")
      .select(
        "id, key, label, billable, counts_for_per_diem, default_rate_cents, default_units, sort_order, archived_at"
      )
      .order("sort_order", { ascending: true })
      .order("key", { ascending: true }),
    supabase
      .from("trip_days")
      .select("day_on, day_type_id, rate_cents, quantity, units, away, notes")
      .eq("trip_id", id)
      .order("day_on", { ascending: true }),
    // Fetched account-wide and filtered to this trip's client below,
    // rather than adding a dependent second round trip once client_id is
    // known — RLS already scopes this to the tenant.
    supabase.from("client_rates").select("client_id, day_type_id, rate_cents"),
    // F8: the freeze is keyed on whether a LIVE invoice line references
    // this trip, not on the cached trips.billing_state — see
    // 20260807020000's section 2 for why billing_state alone leaves the
    // entire draft-invoice window open. Single source of truth: the same
    // function the two database triggers now call. `as never`: see
    // actions.ts's updateTrip for why the args need this cast against
    // this hand-authored types file.
    supabase.rpc("trip_committed_invoice", {
      p_account_id: account.id,
      p_trip_id: id,
    } as never),
    // Settlement panel (roadmap #5): every invoice_lines row directly tied
    // to this trip, any line_type — lib/trip-settlement.ts prices the
    // flight_day/travel_day subset and flags the rest as "other charges"
    // on the same invoice. Rebill lines are deliberately excluded: they
    // resolve their trip through expense_id, not trip_id (see
    // pilot.trip_pl's own comment on that), and this panel's scope is day
    // money only.
    supabase
      .from("invoice_lines")
      .select("invoice_id, line_type, amount_cents")
      .eq("trip_id", id),
    loadOptionChoices("trip_kind"),
  ]);

  // A failed QUERY is not a missing trip. Rendering "this page could not
  // be found" when Supabase returned a 503 sends the pilot hunting for a
  // trip they never lost; the error boundary is the honest answer.
  if (tripError) {
    throw new Error(`Couldn't load trip ${id}: ${tripError.message}`);
  }
  // Same reasoning as tripError above, for the two reads this page used to
  // let fail silently: a failed trip_legs read must not render as a trip
  // with zero legs (subtitle "0 legs", an empty editable LegEditor — a
  // tired pilot re-enters legs that already exist, producing duplicate
  // logbook drafts), and a failed clients read must not empty the client
  // picker on a form that posts client_id.
  if (legError) {
    throw new Error(`Couldn't load trip ${id}'s legs: ${legError.message}`);
  }
  if (clientError) {
    throw new Error(`Couldn't load clients: ${clientError.message}`);
  }
  if (dayTypeError) {
    throw new Error(`Couldn't load day types: ${dayTypeError.message}`);
  }
  if (tripDayError) {
    throw new Error(`Couldn't load trip ${id}'s day grid: ${tripDayError.message}`);
  }
  if (clientRateError) {
    throw new Error(`Couldn't load client rates: ${clientRateError.message}`);
  }
  if (committedError) {
    throw new Error(`Couldn't check ${id}'s billing status: ${committedError.message}`);
  }

  const trip = tripData as (TripFormValues & {
    id: string;
    starts_on: string;
    ends_on: string;
    day_rate_cents: number;
    day_count: number;
    travel_day_count: number | null;
    travel_day_rate_cents: number | null;
    billing_state: string;
  }) | null;

  // Another tenant's id and a nonexistent one both return no row under
  // RLS, so a probe can't tell them apart.
  if (!trip) notFound();

  const legs = (legData ?? []) as LegRow[];
  // Cast carries one extra column (cancellation_policy_note) past
  // ClientOption's own shape — structurally fine to still hand to
  // TripForm below, which only ever reads the fields it declares.
  const clients = (clientData ?? []) as (ClientOption & {
    cancellation_policy_note: string | null;
  })[];
  // gap S: guided cancellation-fee billing. The client's own recorded
  // terms, surfaced right where a pilot is looking at a canceled trip —
  // today this is only ever shown on the CLIENT page, which is a screen
  // away from the trip a pilot is actually canceling.
  const cancellationNote = trip.client_id
    ? clients.find((c) => c.id === trip.client_id)?.cancellation_policy_note ?? null
    : null;
  const dayTypes = (dayTypeData ?? []) as DayTypeOption[];
  const tripDays = (tripDayData ?? []) as TripDayRow[];
  // client_rates is fetched for the whole account (see the query above)
  // and filtered here to this trip's client — day-grid.tsx's rate
  // resolution only ever looks at overrides for THIS trip's client.
  const clientRates = ((clientRateData ?? []) as (ClientRateOption & {
    client_id: string;
  })[]).filter((rate) => rate.client_id === trip.client_id);

  const billedOn = committedOn ?? null;
  // F8: replaces `billing_state === 'invoiced' || billing_state === 'paid'`
  // — see the query comment above for why that missed a trip sitting on a
  // draft invoice.
  const locked = billedOn !== null;

  const blockTotal = legs.reduce((sum, leg) => sum + (leg.block_hours ?? 0), 0);
  const nightFullStop = legs.reduce(
    (sum, leg) => sum + leg.night_landings_full_stop,
    0
  );

  // F3/H6: the same day-rows-aware pricing every list/detail screen now
  // shares (lib/trip-value.ts) — once day rows exist, createInvoiceDraft
  // prices the trip from THEM, grouping billable rows by (day_type_id,
  // rate_cents), and ignores day_rate_cents/day_count/
  // travel_day_rate_cents/travel_day_count entirely. Showing the scalar
  // total here once rows exist would be exactly the "two sources for one
  // number" defect this screen's comment used to warn about: a figure the
  // invoice will not bill.
  const hasDayRows = tripDays.length > 0;
  const fleet = await loadFleetOptions();
  const billableByDayType = new Map(dayTypes.map((t) => [t.id, t.billable]));
  const value = tripValueCents(trip, tripDays, billableByDayType);

  // Settlement panel (roadmap #5 remainder): expected vs invoiced vs paid.
  // tripLineData was read in the first Promise.all above (query comment
  // there explains the trip_id-only scope); the invoices/payments it
  // references are read here, second, because which ids to ask for is not
  // known until the lines come back — the same dependent-read shape
  // invoices/[id]/page.tsx uses for its late fees' source invoices.
  const tripLines = (tripLineData ?? []) as TripSettlementLineRow[];
  const tripInvoiceIds = [...new Set(tripLines.map((l) => l.invoice_id))];

  let settlement: TripSettlement | null = null;
  // A failed read here is never rendered as a healthy $0.00 — see
  // settlement-panel.tsx's own loadError prop, matching the moneyError
  // pattern on the invoice detail screen.
  let settlementLoadError: string | null = null;

  if (tripLineError) {
    settlementLoadError = `Couldn't load this trip's invoice lines: ${tripLineError.message}`;
  } else {
    let settlementInvoices: TripSettlementInvoiceRow[] = [];
    let settlementPayments: TripSettlementPaymentRow[] = [];
    if (tripInvoiceIds.length > 0) {
      const [
        { data: invoiceRows, error: invoiceRowsError },
        { data: paymentRows, error: paymentRowsError },
      ] = await Promise.all([
        supabase.from("invoices").select("id, status, invoice_number").in("id", tripInvoiceIds),
        supabase
          .from("invoice_payments")
          .select("invoice_id, amount_cents")
          .in("invoice_id", tripInvoiceIds),
      ]);
      const settlementError = invoiceRowsError ?? paymentRowsError;
      if (settlementError) {
        settlementLoadError = `Couldn't load this trip's invoice or payment records: ${settlementError.message}`;
      } else {
        settlementInvoices = (invoiceRows ?? []) as TripSettlementInvoiceRow[];
        settlementPayments = (paymentRows ?? []) as TripSettlementPaymentRow[];
      }
    }
    if (!settlementLoadError) {
      settlement = computeTripSettlement({
        trip,
        dayRows: tripDays,
        billableByDayType,
        lines: tripLines,
        invoices: settlementInvoices,
        payments: settlementPayments,
      });
    }
  }

  // P2: once the day grid has rows, it is what bills — and it must also be
  // what this headline COUNTS, not just what it prices. Printing a value
  // derived from tripDays next to a day count still read from the legacy
  // day_count/travel_day_count scalars is the exact "two sources for one
  // number" defect this screen's own comment above warns about, just for
  // days instead of dollars: a pilot who corrects the grid (2 scalar days
  // -> 3 grid days) would see a header whose value moved but whose count
  // didn't. tripDayQuantity mirrors pilot.trip_pl's day_quantity — same
  // billable-only filter, same quantity*units, summed once and rounded
  // once — so this can never disagree with the report that uses the same
  // rule server-side.
  const gridDayQuantity = hasDayRows
    ? tripDayQuantity(tripDays, billableByDayType)
    : null;
  const dayCountLabel =
    gridDayQuantity !== null
      ? `${gridDayQuantity} billable day${gridDayQuantity === 1 ? "" : "s"}`
      : `${trip.day_count} flight day${
          Number(trip.day_count) === 1 ? "" : "s"
        }${
          trip.travel_day_count
            ? ` · ${trip.travel_day_count} travel day${
                trip.travel_day_count === 1 ? "" : "s"
              }`
            : ""
        }`;

  // F5: keyed on the trip's id and dates only — NOT on the persisted day
  // rows' content anymore. That extra component used to force a remount
  // (and reset DayGrid's useActionState) on every successful save of the
  // day grid itself, since saving is exactly what changes that content —
  // so "Day grid saved." was destroyed by the render that was supposed to
  // show it. The day grid is the only writer of trip_days, so there is no
  // OTHER source of a trip_days change that isn't already covered by the
  // dates changing (F4's prune only runs alongside a date change). A
  // remount is still correct, and still happens, whenever the calendar
  // shape of the grid itself changes.
  const dayGridKey = `${trip.id}|${trip.starts_on}|${trip.ends_on}`;

  return (
    <PageShell
      title={formatDateRange(trip.starts_on, trip.ends_on)}
      subtitle={`${formatCents(value)} · ${dayCountLabel} · ${legs.length} leg${
        legs.length === 1 ? "" : "s"
      }`}
      action={
        <Flex gap="2" wrap="wrap" align="start">
          {/* The trip's own state is what everything downstream filters
              on, so the action that changes it belongs here — beside the
              title — not buried mid-form. See markTripCompleted. */}
          {trip.status === "scheduled" || trip.status === "in_progress" ? (
            <MarkFlownButton id={trip.id} />
          ) : null}
          {/* gap S: the recurring-gig case — same client, same tail, same
              rates, next week — typed from scratch every time until now.
              A plain link, not a server action: nothing is written until
              the pre-filled form on the other end is actually submitted. */}
          <Button asChild variant="soft">
            <NextLink href={`/trips/new?clone=${trip.id}`}>Duplicate</NextLink>
          </Button>
          <DeleteTripButton id={trip.id} disabled={locked} />
        </Flex>
      }
    >
      {/* THE THESIS, MADE NAVIGABLE. One trip produces a logbook entry, a
          billable line and an expense file — and until now the trip page
          linked to none of the three, so a pilot had to know the product's
          internal geography and go back out to the rail. The ?trip=
          preselect on the expense form was already built and had no caller
          anywhere in the app. */}
      {trip.status === "completed" ? (
        <Card mb="4">
          <Flex gap="3" wrap="wrap" align="center">
            <Text size="2" color="gray">
              This trip is flown. Next:
            </Text>
            <Button asChild variant="soft" size="2">
              <NextLink href={`/expenses/new?trip=${trip.id}`}>Add an expense</NextLink>
            </Button>
            <Button asChild variant="soft" size="2">
              <NextLink href="/logbook/drafts">Confirm logbook entries</NextLink>
            </Button>
            <Button asChild variant="soft" size="2">
              <NextLink
                href={
                  trip.client_id
                    ? `/invoices/new?client=${trip.client_id}`
                    : "/invoices/new"
                }
              >
                Invoice it
              </NextLink>
            </Button>
          </Flex>
        </Card>
      ) : null}
      {trip.status === "canceled" ? (
        // gap S: guided cancellation-fee billing. The machinery was
        // already half-built — canceled_at is trigger-recorded evidence,
        // cancellation_notice_from is captured on the form above, and
        // clients.cancellation_policy_note is recorded — but nothing on
        // THIS screen ever pointed at it, so a pilot canceling a trip saw
        // no next step and the fee became a fully manual, unlinked
        // invoice line. The invoice trip picker only offers completed
        // trips (see clients/[id]/page.tsx's own comment on that), so
        // this still can't preselect the trip — it can only get the
        // pilot to the right client with the right terms in view.
        <Card mb="4">
          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              This trip is canceled
              {trip.canceled_at ? ` (recorded ${formatDate(trip.canceled_at.slice(0, 10))})` : ""}
              {trip.cancellation_notice_from
                ? `, notice from ${trip.cancellation_notice_from}`
                : ""}
              .
            </Text>
            {cancellationNote ? (
              <Text size="2" color="gray">
                <Text as="span" weight="bold">
                  Cancellation terms on file:
                </Text>{" "}
                {cancellationNote}
              </Text>
            ) : null}
            <Flex gap="3" wrap="wrap" align="center">
              <Button asChild variant="soft" size="2">
                <NextLink
                  href={
                    trip.client_id
                      ? `/invoices/new?client=${trip.client_id}`
                      : "/invoices/new"
                  }
                >
                  Bill a cancellation fee
                </NextLink>
              </Button>
              <Text size="1" color="gray">
                Opens a new invoice for this client — the fee is a
                hand-typed line, never computed automatically.
              </Text>
            </Flex>
          </Flex>
        </Card>
      ) : null}
      {locked ? (
        <Card mb="4">
          <Text size="2" color="gray">
            This trip is billed on {billedOn}. Its dates and amounts are
            frozen here — correcting them would leave the trip and that
            invoice disagreeing about what was flown. Remove it from the
            invoice first.
          </Text>
        </Card>
      ) : null}
      {overlap === "1" ? (
        // gap S: advisory only, never a block — this trip already saved.
        <Callout.Root color="amber" mb="4">
          <Callout.Text>
            This trip&rsquo;s dates overlap another trip on your calendar —
            check you haven&rsquo;t double-booked or double-entered it.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      <Grid columns={{ initial: "1", lg: "12" }} gap="4">
        <Box gridColumn={{ lg: "span 7" }}>
          <TripForm
            action={updateTrip}
            clients={clients}
            tripKinds={tripKinds}
            values={trip}
            submitLabel="Save trip"
            cancelHref="/trips"
            locked={locked}
            hasDayRows={hasDayRows}
            fleet={fleet}
          />
        </Box>
        <Box gridColumn={{ lg: "span 5" }}>
          <Card size="3">
            <Heading as="h2" size="4">Legs</Heading>
            <Text as="p" size="2" color="gray" className="tnum">
              {blockTotal.toFixed(1)} block hours ·{" "}
              {nightFullStop} night full-stop landing
              {nightFullStop === 1 ? "" : "s"}
            </Text>
            <LegEditor tripId={trip.id} legs={legs} defaultDate={trip.starts_on} />
          </Card>
        </Box>

        <Box gridColumn={{ lg: "span 12" }}>
          <Card size="3">
            <Heading as="h2" size="4">Day grid</Heading>
            <Text as="p" size="2" color="gray" mb="3">
              One row per calendar day of the trip — this is what feeds
              invoicing and per diem, and once it has rows it is what
              sets the headline value above, not the flight/travel
              totals below.
            </Text>
            <DayGrid
              key={dayGridKey}
              tripId={trip.id}
              startsOn={trip.starts_on}
              endsOn={trip.ends_on}
              locked={locked}
              billedOn={billedOn}
              dayTypes={dayTypes}
              existingDays={tripDays}
              clientRates={clientRates}
              scalars={{
                dayRateCents: trip.day_rate_cents,
                dayCount: Number(trip.day_count),
                travelDayRateCents: trip.travel_day_rate_cents,
                travelDayCount: Number(trip.travel_day_count ?? 0),
              }}
            />
          </Card>
        </Box>

        <Box gridColumn={{ lg: "span 12" }}>
          <SettlementPanel settlement={settlement} loadError={settlementLoadError} />
        </Box>
      </Grid>
    </PageShell>
  );
}
