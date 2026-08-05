import { requireAccount } from "@/lib/supabase/account";
import PageShell from "../../page-shell";
import ClientForm from "../client-form";
import { createClientRecord } from "../actions";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireAccount("/clients/new");

  return (
    <PageShell
      title="New client"
      subtitle="An owner, operator, or management company you fly for."
    >
      <ClientForm action={createClientRecord} submitLabel="Create client" />
    </PageShell>
  );
}
