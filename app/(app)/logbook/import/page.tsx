import { requireAccount } from "@/lib/supabase/account";
import { LPageShell } from "@/components/ledger/page-shell";
import ImportWorkspace from "./import-workspace";

export const metadata = { title: "Import logbook" };

/**
 * Upload -> parse -> preview -> confirm. Nothing lands in
 * pilot.logbook_entries until the pilot reviews the parsed rows and
 * clicks confirm on the preview screen (import-workspace.tsx) — the same
 * draft-confirm boundary /logbook/drafts uses for trip-derived entries,
 * applied here to file import. Parsing itself (lib/logbook-import/*)
 * happens entirely in the browser; only the pilot's reviewed, resolved
 * rows are ever sent to the server (see ./actions.ts's confirmImport).
 */
export default async function LogbookImportPage() {
  await requireAccount("/logbook/import");

  return (
    <LPageShell
      title="Import your logbook"
      subtitle="Bring in flight time from ForeFlight, LogTen Pro, or any other CSV export. Nothing is written until you review and confirm."
    >
      <ImportWorkspace />
    </LPageShell>
  );
}
