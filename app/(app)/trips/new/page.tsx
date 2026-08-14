import { requireAccount } from "@/lib/supabase/account";
import { createClient } from "@/lib/supabase/server";
import { loadFleetOptions } from "@/lib/fleet";
import { loadOptionChoices } from "@/lib/custom-options-read";
import PageShell from "../../page-shell";
import TripForm, { type ClientOption, type TripFormValues } from "../trip-form";
import { createTrip } from "../actions";

export const metadata = { title: "New trip" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewTripPage({
  searchParams,
}: {
  // gap S: "Duplicate" on the trip page links here with ?clone=<id> — a
  // recurring gig (same client, same tail, same rates, next week) is the
  // norm for a contract pilot, and until now every trip was typed from
  // scratch every time.
  searchParams: Promise<{ clone?: string }>;
}) {
  const { account } = await requireAccount("/trips/new");
  const { clone } = await searchParams;

  const supabase = await createClient();
  // Archived clients are excluded from the picker but keep their existing
  // trips — archiving is about what shows up in new work, not history.
  const { data, error } = await supabase
    .from("clients")
    // operating_rule is selected for the same reason the two rate columns
    // are: the picker seeds a new trip from the client it points at. Without
    // it a new trip silently keeps the form's 'part_91' default no matter
    // which client is chosen, which for a Part 135 operator is the wrong
    // part on a field that gates the 135.301(a) grace (20260807130000).
    .select(
      "id, name, default_day_rate_cents, default_travel_day_rate_cents, operating_rule"
    )
    .is("archived_at", null)
    .order("name", { ascending: true });

  const fleet = await loadFleetOptions();
  // The tenant's own trip-kind list. Never empty — choicesFor falls back
  // to the stock vocabulary if the options table can't be read.
  const tripKinds = await loadOptionChoices("trip_kind");

  // Without this, a failed query renders the reassuring "No active
  // clients yet" empty state to a pilot who has plenty.
  if (error) {
    throw new Error(`Couldn't load your clients: ${error.message}`);
  }

  // gap S (clone trip): client, kind, operating rule, tail, type and rates
  // only — dates come back blank (this is a NEW trip, not a copy of the
  // old one's calendar) and legs/day rows are never touched, because
  // there is nothing here that reads or writes either table. A bad or
  // another tenant's id (RLS returns no row either way) just falls back
  // to a plain blank form rather than erroring — cloning is a convenience,
  // not something worth failing the whole page over.
  let cloneValues: TripFormValues | undefined;
  if (clone && UUID_RE.test(clone)) {
    const { data: sourceTrip } = await supabase
      .from("trips")
      .select(
        "client_id, trip_kind, operating_rule, aircraft_ident, aircraft_type, day_rate_cents, travel_day_rate_cents"
      )
      .eq("id", clone)
      .maybeSingle();
    if (sourceTrip) {
      const s = sourceTrip as {
        client_id: string | null;
        trip_kind: string | null;
        operating_rule: string | null;
        aircraft_ident: string | null;
        aircraft_type: string | null;
        day_rate_cents: number | null;
        travel_day_rate_cents: number | null;
      };
      cloneValues = {
        client_id: s.client_id,
        trip_kind: s.trip_kind,
        operating_rule: s.operating_rule,
        aircraft_ident: s.aircraft_ident,
        aircraft_type: s.aircraft_type,
        day_rate_cents: s.day_rate_cents,
        travel_day_rate_cents: s.travel_day_rate_cents,
      };
    }
  }

  return (
    <PageShell
      title={cloneValues ? "New trip (duplicated)" : "New trip"}
      subtitle={
        cloneValues
          ? "Client, aircraft and rates carried over — pick new dates and add legs once it's saved."
          : "The job you flew. Legs, expenses, and the invoice all hang off it."
      }
    >
      <TripForm
        action={createTrip}
        clients={(data ?? []) as ClientOption[]}
        tripKinds={tripKinds}
        values={cloneValues}
        submitLabel="Create trip"
        fleet={fleet}
        // The onboarding wizard's account-level rate defaults
        // (20260812400000), finally consumed: they seed a brand-new
        // trip's blank rate fields and back up a picked client that has
        // no agreed rate of its own. A narrow two-field object, NOT the
        // account row — requireAccount's row carries Stripe ids and must
        // never reach a client component (see settings/page.tsx). The
        // edit screen (trips/[id]) deliberately omits this prop: an
        // existing trip's stored rates are never re-priced.
        accountDefaults={{
          day_rate_cents: account.default_day_rate_cents,
          travel_day_rate_cents: account.default_travel_day_rate_cents,
        }}
      />
    </PageShell>
  );
}
