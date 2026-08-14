import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import PageShell from "../../page-shell";
import { createEstimateDraft } from "../actions";
import NewEstimateForm, { type ClientOption } from "./new-form";

export const metadata = { title: "New estimate" };

export default async function NewEstimatePage() {
  await requireEntitlement("estimates", "/estimates/new");

  const supabase = await createClient();

  // Archived clients are excluded — same rule as the trip and invoice
  // forms: archiving is about what shows up in new work, not history.
  const { data: clientData, error: clientsError } = await supabase
    .from("clients")
    .select("id, name")
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (clientsError) {
    throw new Error(`Couldn't load your clients: ${clientsError.message}`);
  }

  const clients = (clientData ?? []) as ClientOption[];

  return (
    <PageShell
      title="New estimate"
      subtitle="Quote the work before it's flown: day rates, travel days, per diem. It stays a draft until you send it."
    >
      <NewEstimateForm action={createEstimateDraft} clients={clients} />
    </PageShell>
  );
}
