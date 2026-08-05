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
import { updateTrip } from "../actions";
import DeleteTripButton from "./delete-trip-button";

export const metadata = { title: "Trip" };

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAccount(`/trips/${id}`);

  const supabase = await createClient();
  const [
    { data: tripData, error: tripError },
    { data: legData },
    { data: clientData },
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
  ]);

  // A failed QUERY is not a missing trip. Rendering "this page could not
  // be found" when Supabase returned a 503 sends the pilot hunting for a
  // trip they never lost; the error boundary is the honest answer.
  if (tripError) {
    throw new Error(`Couldn't load trip ${id}: ${tripError.message}`);
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

  const blockTotal = legs.reduce((sum, leg) => sum + (leg.block_hours ?? 0), 0);
  const nightFullStop = legs.reduce(
    (sum, leg) => sum + leg.night_landings_full_stop,
    0
  );
  // Flight days AND travel days. Leaving travel days out here while
  // Phase 5 drafts them as their own invoice line would make the trip
  // screen and the invoice disagree about what the job is worth.
  const flightValue = Math.round(trip.day_rate_cents * Number(trip.day_count));
  const travelValue = Math.round(
    (trip.travel_day_rate_cents ?? 0) * Number(trip.travel_day_count ?? 0)
  );
  const value = flightValue + travelValue;

  // `written_off` is excluded on purpose: the migration describes it as
  // set by hand and never touched by the invoice sync, so a written-off
  // trip has not necessarily been invoiced at all. Calling it "invoiced"
  // and refusing to delete it would be false on both counts.
  const locked = trip.billing_state === "invoiced" || trip.billing_state === "paid";

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
                This trip is on an invoice. Its dates and amounts are frozen
                here — correcting them would leave the trip and the invoice
                that has already gone out disagreeing about what was flown.
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
      </Grid>
    </PageShell>
  );
}
