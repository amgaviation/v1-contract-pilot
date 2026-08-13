import { requireAccount } from "@/lib/supabase/account";
import { createClient } from "@/lib/supabase/server";
import { loadFleetOptions } from "@/lib/fleet";
import { loadOptionChoices } from "@/lib/custom-options-read";
import PageShell from "../../page-shell";
import TripForm, { type ClientOption } from "../trip-form";
import { createTrip } from "../actions";

export const metadata = { title: "New trip" };

export default async function NewTripPage() {
  const { account } = await requireAccount("/trips/new");

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

  return (
    <PageShell
      title="New trip"
      subtitle="The job you flew. Legs, expenses, and the invoice all hang off it."
    >
      <TripForm
        action={createTrip}
        clients={(data ?? []) as ClientOption[]}
        tripKinds={tripKinds}
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
