import { notFound } from "next/navigation";
import { Card, Flex, Text } from "@/components/ui";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDate } from "@/lib/format";
import PageShell from "../../page-shell";
import DocumentForm, { type DocumentFormValues } from "../document-form";
import { updateDocument } from "../actions";
import { loadClientOptions } from "../client-options";
import { loadOptionChoices, loadOptionLabels } from "@/lib/custom-options-read";
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
  // Kinds twice over, and they are not the same list: `kinds` is what the
  // picker may OFFER (retired ones dropped), `kindLabels` is what a
  // stored key is CALLED (retired ones included, because this document
  // may be filed under one).
  const [{ data, error }, { clients, error: clientError }, kinds, kindLabels] =
    await Promise.all([
      supabase.from("documents").select("*").eq("id", id).maybeSingle(),
      loadClientOptions(),
      loadOptionChoices("document_kind"),
      loadOptionLabels("document_kind"),
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
      subtitle={`${kindLabels[doc.kind] ?? "Other"}${
        doc.expires_on ? ` · Expires ${formatDate(doc.expires_on)}` : " · No expiry"
      }`}
      action={<DeleteDocumentButton id={doc.id} />}
    >
      {doc.file_path ? (
        <Card>
          <Flex justify="between" align="center" gap="3" p="1">
            <Text size="2" color="gray">
              A file is attached. It&rsquo;s stored privately — the link below works for one
              minute.
            </Text>
            <DocumentLink path={doc.file_path} />
          </Flex>
        </Card>
      ) : null}

      <DocumentForm
        action={updateDocument}
        clients={clients}
        kinds={kinds}
        values={doc}
        submitLabel="Save document"
      />
    </PageShell>
  );
}
