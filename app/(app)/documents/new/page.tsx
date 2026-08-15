import { requireAccount } from "@/lib/supabase/account";
import PageShell from "../../page-shell";
import DocumentForm from "../document-form";
import { createDocument } from "../actions";
import { loadClientOptions } from "../client-options";
import { loadOptionChoices } from "@/lib/custom-options-read";

export const metadata = { title: "Add document" };

export default async function NewDocumentPage() {
  await requireAccount("/documents/new");

  const { clients, error } = await loadClientOptions();
  // The tenant's own kind list — their labels and order. Never empty:
  // choicesFor falls back to the stock vocabulary if the options table
  // cannot be read, so a settings-table blip can't leave a pilot unable
  // to file a document.
  const kinds = await loadOptionChoices("document_kind");
  // A failed query would otherwise render an empty client picker, which
  // reads as "you have no clients" rather than "something broke".
  if (error) throw new Error(`Couldn't load your clients: ${error}`);

  return (
    <PageShell
      title="Add document"
      subtitle="Enter the dates as printed: medical, flight review, passport, certificate, insurance policy, or W-9."
    >
      <DocumentForm
        action={createDocument}
        clients={clients}
        kinds={kinds}
        submitLabel="Save document"
      />
    </PageShell>
  );
}
