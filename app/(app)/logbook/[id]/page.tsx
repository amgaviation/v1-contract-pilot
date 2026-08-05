import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDate } from "@/lib/format";
import PageShell from "../../page-shell";
import LogbookEntryForm, { type LogbookEntryFormValues } from "../logbook-entry-form";
import { updateLogbookEntry } from "../actions";
import { logbookFrom, type LogbookEntryRow, type LogbookSource } from "../db";
import DeleteLogbookEntryButton from "./delete-logbook-entry-button";

export const metadata = { title: "Logbook entry" };

const SOURCE_LABEL: Record<LogbookSource, string> = {
  manual: "Logged by hand.",
  trip: "Confirmed from a trip leg.",
  import: "Imported from a file.",
  foreflight_sync: "Synced from ForeFlight.",
};

export default async function LogbookEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAccount(`/logbook/${id}`);

  const supabase = await createClient();
  const { data, error } = await logbookFrom(supabase, "logbook_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // A failed QUERY is not a missing entry — see the same note in
  // app/(app)/trips/[id]/page.tsx.
  if (error) {
    throw new Error(`Couldn't load logbook entry ${id}: ${error.message}`);
  }

  const entry = data as LogbookEntryRow | null;
  // Another tenant's id and a nonexistent one both return no row under
  // RLS, so a probe can't tell them apart.
  if (!entry) notFound();

  return (
    <PageShell
      title={`${entry.from_icao ?? "—"} → ${entry.to_icao ?? "—"}`}
      subtitle={`${formatDate(entry.entry_date)} · ${Number(entry.total_time).toFixed(1)} hours`}
      action={<DeleteLogbookEntryButton id={entry.id} />}
    >
      <LogbookEntryForm
        action={updateLogbookEntry}
        values={entry as LogbookEntryFormValues & { id: string }}
        submitLabel="Save entry"
        provenanceNote={`${SOURCE_LABEL[entry.source]} You can correct the flight data below, but where it came from can't be changed here.`}
      />
    </PageShell>
  );
}
