import { notFound } from "next/navigation";
import { LCard } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import type { Database } from "@/lib/supabase/database.types";
import CrewForm from "../crew-form";
import { updateCrewMember } from "../actions";
import ArchiveButton from "./archive-button";
import DeleteRecordButton from "@/components/delete-record-button";
import { deleteCrewMember } from "../actions";

type CrewRow = Database["pilot"]["Tables"]["crew_members"]["Row"];

export const metadata = { title: "Edit crew member" };

export default async function EditCrewMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAccount(`/crew/${id}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_members")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // A failed query is not a missing crew member — same distinction
  // clients/[id]/page.tsx draws: without this, a transient read error and
  // "this id genuinely doesn't exist" would both fall through to notFound().
  if (error) {
    throw new Error(`Couldn't load crew member ${id}: ${error.message}`);
  }

  const crew = data as CrewRow | null;
  // Another tenant's id and a nonexistent id are indistinguishable here,
  // and that is the point: RLS returns no row either way, so a probe
  // can't tell "not yours" from "not real".
  if (!crew) notFound();

  return (
    <LPageShell
      title={crew.name}
      subtitle={crew.archived_at ? "Archived" : "Crew member"}
      action={
        <div className="flex flex-wrap items-start gap-2">
          <ArchiveButton id={crew.id} archived={Boolean(crew.archived_at)} />
          {/* Archive stays first and stays the default. Delete sits beside
              it for the duplicate row and the name typed into the wrong
              form — nothing in the schema references a crew member, so
              this removes exactly this row. See deleteCrewMember. */}
          <DeleteRecordButton
            action={deleteCrewMember.bind(null, crew.id)}
            label="Delete crew member"
            title="Delete this crew member?"
            description="This removes them completely, not just from your pickers. It can’t be undone — archive them instead if you want to keep the record."
            redirectTo="/crew"
          />
        </div>
      }
    >
      {crew.archived_at ? (
        <LCard>
          <p className="text-body-s text-ink-2">
            This crew member is archived. They stay on record. You can
            restore them any time.
          </p>
        </LCard>
      ) : null}

      <CrewForm action={updateCrewMember} values={crew} submitLabel="Save changes" />
    </LPageShell>
  );
}
