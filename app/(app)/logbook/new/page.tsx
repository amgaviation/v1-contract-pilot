import { requireAccount } from "@/lib/supabase/account";
import { loadFleetOptions } from "@/lib/fleet";
import { LPageShell } from "@/components/ledger/page-shell";
import LogbookEntryForm from "../logbook-entry-form";
import { createLogbookEntry } from "../actions";

export const metadata = { title: "New logbook entry" };

export default async function NewLogbookEntryPage() {
  await requireAccount("/logbook/new");
  const fleet = await loadFleetOptions();

  return (
    <LPageShell
      title="Log an entry"
      subtitle="A flight you flew that didn't come from a trip, or one you're backfilling by hand."
    >
      <LogbookEntryForm action={createLogbookEntry} submitLabel="Save entry" fleet={fleet} />
    </LPageShell>
  );
}
