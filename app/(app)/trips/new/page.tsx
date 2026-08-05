import { requireAccount } from "@/lib/supabase/account";
import { createClient } from "@/lib/supabase/server";
import PageShell from "../../page-shell";
import TripForm, { type ClientOption } from "../trip-form";
import { createTrip } from "../actions";

export const metadata = { title: "New trip" };

export default async function NewTripPage() {
  await requireAccount("/trips/new");

  const supabase = await createClient();
  // Archived clients are excluded from the picker but keep their existing
  // trips — archiving is about what shows up in new work, not history.
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, default_day_rate_cents, default_travel_day_rate_cents")
    .is("archived_at", null)
    .order("name", { ascending: true });

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
        submitLabel="Create trip"
      />
    </PageShell>
  );
}
