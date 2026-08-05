import { requireAccount } from "@/lib/supabase/account";
import PageShell from "../../page-shell";
import DocumentForm from "../document-form";
import { createDocument } from "../actions";
import { loadClientOptions } from "../client-options";

export const metadata = { title: "Add document" };

export default async function NewDocumentPage() {
  await requireAccount("/documents/new");

  const { clients, error } = await loadClientOptions();
  // A failed query would otherwise render an empty client picker, which
  // reads as "you have no clients" rather than "something broke".
  if (error) throw new Error(`Couldn't load your clients: ${error}`);

  return (
    <PageShell
      title="Add document"
      subtitle="Enter the dates as printed — a medical, flight review, passport, certificate, insurance policy or W-9."
    >
      <DocumentForm action={createDocument} clients={clients} submitLabel="Save document" />
    </PageShell>
  );
}
