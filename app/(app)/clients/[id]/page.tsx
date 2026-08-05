import { notFound } from "next/navigation";
import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import type { Database } from "@/lib/supabase/database.types";
import PageShell from "../../page-shell";
import ClientForm from "../client-form";
import { updateClientRecord } from "../actions";
import ArchiveButton from "./archive-button";

type ClientRow = Database["pilot"]["Tables"]["clients"]["Row"];

export const metadata = { title: "Edit client" };

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAccount(`/clients/${id}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // A failed query is not a missing client — see the note in
  // trips/[id]/page.tsx.
  if (error) {
    throw new Error(`Couldn't load client ${id}: ${error.message}`);
  }

  const client = data as ClientRow | null;
  // Another tenant's id and a nonexistent id are indistinguishable here,
  // and that is the point: RLS returns no row either way, so a probe
  // can't tell "not yours" from "not real".
  if (!client) notFound();

  return (
    <PageShell
      title={client.name}
      subtitle={client.archived_at ? "Archived" : "Client"}
      action={<ArchiveButton id={client.id} archived={Boolean(client.archived_at)} />}
    >
      {client.archived_at ? (
        <MDBox mb={3}>
          <Card>
            <MDBox p={3}>
              <MDTypography variant="button" color="text" fontWeight="regular">
                This client is archived. Their trips and invoices are
                untouched — they just won&rsquo;t appear when you pick a client
                for new work.
              </MDTypography>
            </MDBox>
          </Card>
        </MDBox>
      ) : null}

      <ClientForm
        action={updateClientRecord}
        values={client}
        submitLabel="Save changes"
      />
    </PageShell>
  );
}
