import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { countOf } from "@/lib/supabase/rows";
import { tripValueCents, type TripDayValueRow } from "@/lib/trip-value";
import PageShell from "../../page-shell";
import { createInvoiceDraft } from "../actions";
import DraftForm, { type ClientOption, type TripOption } from "./draft-form";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { account } = await requireAccount("/invoices/new");
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
  // Declared out here because it is read at render, below the branch that
  // only runs once a client is picked.
  let unmarkedTripCount = 0;
  // Set when the scheduled/in-progress count below fails — see its own
  // comment for why a swallowed error here used to make draft-form.tsx
  // assert "no completed, unbilled trips" instead of admitting it doesn't
  // know.
  let unmarkedTripCountFailed = false;
  if (clientId) {
    // Only what's actually billable: unbilled AND completed. A scheduled
    // or in-progress trip's day count/expenses aren't final yet, so
    // drafting from one would bake in numbers that are still moving.
    const [
      { data: tripData, error: tripsError },
      { data: expenseData, error: expensesError },
      unmarkedForClientResult,
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
      // Trips for this client that are flown-but-unmarked. An empty
      // picker used to say "No completed, unbilled trips for this client
      // yet" — true, and the wrong thing to tell a pilot whose trips are
      // all sitting at Scheduled because nothing in the product ever
      // advanced them.
      supabase
        .from("trips")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .in("status", ["scheduled", "in_progress"]),
    ]);

    const unmarkedForClient = countOf(unmarkedForClientResult);
    unmarkedTripCount = unmarkedForClient.ok ? unmarkedForClient.count : 0;
    unmarkedTripCountFailed = !unmarkedForClient.ok;

    // A failed query here must not read as "this client has no billable
    // trips" — that's indistinguishable from an empty result otherwise,
    // and it would let a pilot draft an invoice missing trips that
    // actually exist.
    if (tripsError || expensesError) {
      tripsErrorMessage = friendlyDbError(
        tripsError ?? expensesError,
        "invoices.new.trips"
      );
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
    const tripIds = rawTrips.map((trip) => trip.id);

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

    // This picker's estimate must resolve day rows vs. the legacy scalar
    // day_count/day_rate_cents pair with the SAME precedence
    // createInvoiceDraft (../actions.ts) uses to actually build the draft
    // — a trip with trip_days rows is priced from THEM, never from the
    // scalar pair. Without this, a pilot who fills in a trip's day grid
    // (a half day, a different rate on one day, a day type the scalar
    // pair knows nothing about) sees one number here and gets billed a
    // different one on the draft it produces — the exact bug this fixes.
    type TripDayRow = {
      trip_id: string;
      day_type_id: string;
      rate_cents: number;
      quantity: number;
      units: number | null;
    };
    type DayTypeRow = { id: string; billable: boolean };
    const [
      { data: dayRowData, error: dayRowsError },
      { data: dayTypeData, error: dayTypesError },
      committedResults,
    ] = await Promise.all([
      tripIds.length > 0
        ? supabase
            .from("trip_days")
            .select("trip_id, day_type_id, rate_cents, quantity, units")
            .in("trip_id", tripIds)
        : Promise.resolve({ data: [] as TripDayRow[], error: null }),
      supabase.from("day_types").select("id, billable"),
      // The freeze is keyed on whether a LIVE invoice line references the
      // trip (pilot.trip_committed_invoice), not on billing_state — a
      // trip can be sitting on someone ELSE's draft invoice and still
      // read 'unbilled' here (billing_state only advances on an invoice
      // STATUS change, never on a line being added to a draft). Checked
      // per trip, same RPC trips/actions.ts and trips/[id]/page.tsx
      // already call. Best-effort: a failed check here doesn't block the
      // picker (see committedByTrip below) — the batched insert's own
      // double-bill guard is still the real enforcement either way.
      Promise.all(
        tripIds.map((id) =>
          // `as never`: same reason every write in this codebase casts
          // its payload — the hand-authored Database type doesn't resolve
          // cleanly through this client's generics, this time for .rpc()'s
          // args rather than .insert()'s payload. Return value is cast at
          // the boundary below (committedByTrip), same convention.
          supabase.rpc("trip_committed_invoice", {
            p_account_id: account.id,
            p_trip_id: id,
          } as never)
        )
      ),
    ]);

    // Same reasoning as createInvoiceDraft's own dayRowsError/
    // dayTypesError handling: guessing "no day rows, fall back to scalar"
    // on a fetch failure could show (and then draft) a lower number than
    // the trip actually has day rows for. Fail loud instead, only when
    // the trips/expenses fetch itself didn't already set the message.
    if (!tripsErrorMessage && (dayRowsError || dayTypesError)) {
      tripsErrorMessage = friendlyDbError(
        dayRowsError ?? dayTypesError,
        "invoices.new.trip_days"
      );
    }

    const dayTypeBillable = new Map<string, boolean>(
      ((dayTypeData ?? []) as DayTypeRow[]).map((dt) => [dt.id, dt.billable])
    );
    const dayRowsByTrip = new Map<string, TripDayRow[]>();
    for (const row of (dayRowData ?? []) as TripDayRow[]) {
      const forTrip = dayRowsByTrip.get(row.trip_id) ?? [];
      forTrip.push(row);
      dayRowsByTrip.set(row.trip_id, forTrip);
    }
    // Best-effort, per trip: an individual RPC failure reads as "not
    // known to be committed elsewhere" rather than blocking the whole
    // picker — see the Promise.all comment above.
    const committedByTrip = new Map<string, string | null>(
      tripIds.map((id, index) => [
        id,
        (committedResults[index]?.data as string | null | undefined) ?? null,
      ])
    );

    trips = rawTrips.map((trip) => {
      const tripDayRows = dayRowsByTrip.get(trip.id) ?? [];
      const hasDayRows = tripDayRows.length > 0;

      // lib/trip-value.ts's tripValueCents — NOT a hand-rolled sum. It
      // groups by (day_type_id, rate_cents) and rounds PER GROUP, exactly
      // the way createInvoiceDraft emits one invoice line per group and
      // pilot.invoice_lines.amount_cents rounds per line. Rounding once
      // over the whole trip instead (the previous approach here) can
      // disagree with the invoice by a cent whenever two groups' summed
      // quantity × rate isn't itself a whole number of cents — see the
      // file's own header for the worked example.
      const value = tripValueCents(
        trip,
        tripDayRows as TripDayValueRow[],
        dayTypeBillable
      );

      return {
        ...trip,
        rebillable_expense_cents: rebillByTrip.get(trip.id) ?? 0,
        estimated_value_cents: value + (rebillByTrip.get(trip.id) ?? 0),
        // The scalar travel-rate gap only means anything for a trip
        // actually billing off the scalar pair — once day rows exist
        // they supersede it entirely, the same way createInvoiceDraft
        // never looks at travel_day_rate_cents for a day-row trip.
        missing_travel_rate:
          !hasDayRows &&
          trip.travel_day_count > 0 &&
          trip.travel_day_rate_cents === null,
        has_day_rows: hasDayRows,
        committed_invoice_label: committedByTrip.get(trip.id) ?? null,
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
        unmarkedTripCount={unmarkedTripCount ?? 0}
        unmarkedTripCountFailed={unmarkedTripCountFailed}
      />
    </PageShell>
  );
}
