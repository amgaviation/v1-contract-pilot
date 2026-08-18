import { requireAccount } from "@/lib/supabase/account";
import { LPageShell } from "@/components/ledger/page-shell";
import CrewForm from "../crew-form";
import { createCrewMember } from "../actions";

export const metadata = { title: "New crew member" };

export default async function NewCrewMemberPage() {
  await requireAccount("/crew/new");

  return (
    <LPageShell
      title="New crew member"
      subtitle="A pilot or crew member you fly with, or employ."
    >
      <CrewForm action={createCrewMember} submitLabel="Create crew member" />
    </LPageShell>
  );
}
