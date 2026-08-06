import { notFound } from "next/navigation";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";

import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDateRange } from "@/lib/format";
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

export const metadata = { title: "Trip" };

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { account } = await requireAccount(`/trips/${id}`);

  const supabase = await createClient();
  const [
    { data: tripData, error: tripError },
    { data: legData },
    { data: clientData },
    { data: dayTypeData, error: dayTypeError },
    { data: tripDayData, error: tripDayError },
    { data: clientRateData, error: clientRateError },
    { data: committedOn, error: committedError },
  ] = await Promise.all([
    supabase.from("trips").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("trip_legs")
      .select("*")
      .eq("trip_id", id)
      .order("leg_date", { ascending: true }),
    supabase
      .from("clients")
      .select("id, name, default_day_rate_cents, default_travel_day_rate_cents")
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
      .select("id, key, label, billable, default_rate_cents, sort_order, archived_at")
      .order("sort_order", { ascending: true })
      .order("key", { ascending: true }),
    supabase
      .from("trip_days")
      .select("day_on, day_type_id, rate_cents, quantity, notes")
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
  ]);

  // A failed QUERY is not a missing trip. Rendering "this page could not
  // be found" when Supabase returned a 503 sends the pilot hunting for a
  // trip they never lost; the error boundary is the honest answer.
  if (tripError) {
    throw new Error(`Couldn't load trip ${id}: ${tripError.message}`);
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
  const clients = (clientData ?? []) as ClientOption[];
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

  // F3: once day rows exist, createInvoiceDraft prices the trip from
  // THEM — grouping billable rows by (day_type_id, rate_cents) — and
  // ignores day_rate_cents/day_count/travel_day_rate_cents/
  // travel_day_count entirely. Showing the scalar total here once rows
  // exist is exactly the "two sources for one number" defect this
  // screen's comment warned about: it would show a figure the invoice
  // will not bill. Mirrored below on trips/page.tsx.
  const hasDayRows = tripDays.length > 0;
  const billableByDayType = new Map(dayTypes.map((t) => [t.id, t.billable]));
  const dayRowsValueCents = tripDays.reduce((sum, day) => {
    if (!billableByDayType.get(day.day_type_id)) return sum;
    return sum + Math.round(Number(day.quantity) * day.rate_cents);
  }, 0);

  // Flight days AND travel days. Leaving travel days out here while
  // Phase 5 drafts them as their own invoice line would make the trip
  // screen and the invoice disagree about what the job is worth.
  const flightValue = Math.round(trip.day_rate_cents * Number(trip.day_count));
  const travelValue = Math.round(
    (trip.travel_day_rate_cents ?? 0) * Number(trip.travel_day_count ?? 0)
  );
  const scalarValue = flightValue + travelValue;
  const value = hasDayRows ? dayRowsValueCents : scalarValue;

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
      subtitle={`${formatCents(value)} · ${trip.day_count} flight day${
        Number(trip.day_count) === 1 ? "" : "s"
      }${
        trip.travel_day_count
          ? ` · ${trip.travel_day_count} travel day${
              trip.travel_day_count === 1 ? "" : "s"
            }`
          : ""
      } · ${legs.length} leg${legs.length === 1 ? "" : "s"}`}
      action={<DeleteTripButton id={trip.id} disabled={locked} />}
    >
      {locked ? (
        <MDBox mb={3}>
          <Card>
            <MDBox p={3}>
              <MDTypography variant="button" color="text" fontWeight="regular">
                This trip is billed on {billedOn}. Its dates and amounts are
                frozen here — correcting them would leave the trip and that
                invoice disagreeing about what was flown. Remove it from the
                invoice first.
              </MDTypography>
            </MDBox>
          </Card>
        </MDBox>
      ) : null}

      <Grid container spacing={3}>
        <Grid item xs={12} lg={7}>
          <TripForm
            action={updateTrip}
            clients={clients}
            values={trip}
            submitLabel="Save trip"
            cancelHref="/trips"
            locked={locked}
            hasDayRows={hasDayRows}
          />
        </Grid>
        <Grid item xs={12} lg={5}>
          <Card>
            <MDBox p={3} pb={0} lineHeight={1.25}>
              <MDTypography variant="h6">Legs</MDTypography>
              <MDTypography variant="button" color="text" fontWeight="regular">
                {blockTotal.toFixed(1)} block hours ·{" "}
                {nightFullStop} night full-stop landing
                {nightFullStop === 1 ? "" : "s"}
              </MDTypography>
            </MDBox>
            <MDBox p={3} pt={2}>
              <LegEditor
                tripId={trip.id}
                legs={legs}
                defaultDate={trip.starts_on}
              />
            </MDBox>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <MDBox p={3} pb={0} lineHeight={1.25}>
              <MDTypography variant="h6">Day grid</MDTypography>
              <MDTypography variant="button" color="text" fontWeight="regular">
                One row per calendar day of the trip — this is what feeds
                invoicing and per diem, and once it has rows it is what
                sets the headline value above, not the flight/travel
                totals below.
              </MDTypography>
            </MDBox>
            <MDBox p={3} pt={2}>
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
            </MDBox>
          </Card>
        </Grid>
      </Grid>
    </PageShell>
  );
}
