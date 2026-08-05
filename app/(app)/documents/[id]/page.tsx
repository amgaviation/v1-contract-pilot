import { notFound } from "next/navigation";
import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDate } from "@/lib/format";
import PageShell from "../../page-shell";
import DocumentForm, { type DocumentFormValues } from "../document-form";
import { updateDocument } from "../actions";
import { loadClientOptions } from "../client-options";
import { DOCUMENT_KIND_LABEL } from "../kinds";
import DeleteDocumentButton from "./delete-document-button";
import DocumentLink from "./document-link";

export const metadata = { title: "Document" };

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAccount(`/documents/${id}`);

  const supabase = await createClient();
  const [{ data, error }, { clients, error: clientError }] = await Promise.all([
    supabase.from("documents").select("*").eq("id", id).maybeSingle(),
    loadClientOptions(),
  ]);

  // A failed query is not a missing document — rendering a 404 would send
  // the pilot looking for a file they never lost.
  if (error) throw new Error(`Couldn't load document ${id}: ${error.message}`);
  if (clientError) throw new Error(`Couldn't load your clients: ${clientError}`);

  const doc = data as (DocumentFormValues & {
    id: string;
    kind: string;
    expires_on: string | null;
  }) | null;

  // Another tenant's id and a nonexistent one both return no row under
  // RLS, so a probe can't tell them apart.
  if (!doc) notFound();

  return (
    <PageShell
      title={doc.label ?? ""}
      subtitle={`${DOCUMENT_KIND_LABEL[doc.kind] ?? "Other"}${
        doc.expires_on ? ` · Expires ${formatDate(doc.expires_on)}` : " · No expiry"
      }`}
      action={<DeleteDocumentButton id={doc.id} />}
    >
      {doc.file_path ? (
        <MDBox mb={3}>
          <Card>
            <MDBox
              p={3}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              gap={2}
            >
              <MDTypography variant="button" color="text" fontWeight="regular">
                A file is attached. It&rsquo;s stored privately — the link
                below works for one minute.
              </MDTypography>
              <DocumentLink path={doc.file_path} />
            </MDBox>
          </Card>
        </MDBox>
      ) : null}

      <DocumentForm
        action={updateDocument}
        clients={clients}
        values={doc}
        submitLabel="Save document"
      />
    </PageShell>
  );
}
