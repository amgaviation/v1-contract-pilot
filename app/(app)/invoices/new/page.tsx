import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../page-shell";
import { createInvoiceDraft } from "../actions";
import DraftForm, { type ClientOption, type TripOption } from "./draft-form";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  await requireAccount("/invoices/new");
  const { client: clientId } = await searchParams;

  const supabase = await createClient();

  // Archived clients are excluded — same rule as the trip form: archiving
  // is about what shows up in new work, not history.
  const { data: clientData, error: clientsError } = await supabase
    .from("clients")
    .select("id, name")
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (clientsError) {
    throw new Error(`Couldn't load your clients: ${clientsError.message}`);
  }

  const clients = (clientData ?? []) as ClientOption[];

  let trips: TripOption[] = [];
  let tripsErrorMessage: string | null = null;
  if (clientId) {
    // Only what's actually billable: unbilled AND completed. A scheduled
    // or in-progress trip's day count/expenses aren't final yet, so
    // drafting from one would bake in numbers that are still moving.
    const [
      { data: tripData, error: tripsError },
      { data: expenseData, error: expensesError },
    ] = await Promise.all([
      supabase
        .from("trips")
        .select(
          "id, starts_on, ends_on, aircraft_ident, day_rate_cents, day_count, travel_day_count, travel_day_rate_cents"
        )
        .eq("client_id", clientId)
        .eq("billing_state", "unbilled")
        .eq("status", "completed")
        .order("starts_on", { ascending: true }),
      supabase
        .from("expenses")
        .select("id, trip_id, amount_cents")
        .eq("treatment", "rebill"),
    ]);

    // A failed query here must not read as "this client has no billable
    // trips" — that's indistinguishable from an empty result otherwise,
    // and it would let a pilot draft an invoice missing trips that
    // actually exist.
    const firstError = tripsError ?? expensesError;
    if (firstError) {
      tripsErrorMessage = friendlyDbError(firstError, "invoices.new.trips");
    }

    type RawTrip = {
      id: string;
      starts_on: string;
      ends_on: string;
      aircraft_ident: string | null;
      day_rate_cents: number;
      day_count: number;
      travel_day_count: number;
      travel_day_rate_cents: number | null;
    };
    const rawTrips = (tripData ?? []) as RawTrip[];
    const rebillByTrip = new Map<string, number>();
    for (const expense of (expenseData ?? []) as {
      id: string;
      trip_id: string | null;
      amount_cents: number;
    }[]) {
      if (!expense.trip_id) continue;
      rebillByTrip.set(
        expense.trip_id,
        (rebillByTrip.get(expense.trip_id) ?? 0) + expense.amount_cents
      );
    }

    trips = rawTrips.map((trip) => {
      const flightValue = Math.round(trip.day_rate_cents * Number(trip.day_count));
      const travelValue = Math.round(
        (trip.travel_day_rate_cents ?? 0) * Number(trip.travel_day_count)
      );
      return {
        ...trip,
        rebillable_expense_cents: rebillByTrip.get(trip.id) ?? 0,
        estimated_value_cents:
          flightValue + travelValue + (rebillByTrip.get(trip.id) ?? 0),
        missing_travel_rate: trip.travel_day_count > 0 && trip.travel_day_rate_cents === null,
      };
    });
  }

  return (
    <PageShell
      title="New invoice"
      subtitle="Pick a client and the trips you've already flown for them. Flight days, travel days, and rebilled expenses become lines automatically."
    >
      <DraftForm
        action={createInvoiceDraft}
        clients={clients}
        selectedClientId={clientId ?? ""}
        trips={trips}
        tripsError={tripsErrorMessage}
      />
    </PageShell>
  );
}
