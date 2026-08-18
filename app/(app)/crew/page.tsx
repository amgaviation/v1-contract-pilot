import NextLink from "next/link";
import { LAlert, LCard, LEmpty, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import type { Database } from "@/lib/supabase/database.types";
import { friendlyDbError } from "@/lib/db-errors";

type CrewRow = Database["pilot"]["Tables"]["crew_members"]["Row"];

export const metadata = { title: "Crew" };

// Supabase's Data API caps rows (commonly 1000) and TRUNCATES SILENTLY on
// a plain select — no error, just a shorter array. An explicit .limit
// makes that boundary visible instead of invisible. Same pattern as
// clients/page.tsx's own CLIENTS_LIMIT.
const CREW_LIMIT = 1000;

export default async function CrewPage() {
  await requireAccount("/crew");

  const supabase = await createClient();
  // RLS scopes this to the caller's tenant; no account_id filter is
  // needed or wanted here (see the note in actions.ts).
  const { data, error } = await supabase
    .from("crew_members")
    .select("*")
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true })
    .limit(CREW_LIMIT);

  const crew = (data ?? []) as CrewRow[];
  const truncated = crew.length === CREW_LIMIT;

  return (
    <LPageShell
      title="Crew"
      subtitle={
        error ? "Couldn't load your crew." : "The pilots and crew you fly with, on record."
      }
      action={
        <NextLink href="/crew/new" className={lButtonClass({ variant: "primary" })}>
          New crew member
        </NextLink>
      }
    >
      {truncated ? (
        <LAlert tone="warn" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            {`This list may be partial. There are more than ${CREW_LIMIT} crew members and only the first ${CREW_LIMIT} are shown.`}
          </span>
        </LAlert>
      ) : null}

      <LCard>
        {error ? (
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError(error, "crew_members.select")}</span>
          </LAlert>
        ) : crew.length === 0 ? (
          <LEmpty
            title="No crew yet"
            action={
              <NextLink href="/crew/new" className={lButtonClass({ variant: "primary" })}>
                Add your first crew member
              </NextLink>
            }
          >
            Add the pilots you fly with. Contact details and certificates
            stay on file.
          </LEmpty>
        ) : (
          <LTable>
            <caption>
              <span className="sr-only">Crew</span>
            </caption>
            <thead>
              <tr>
                <LTh>Name</LTh>
                <LTh>Role</LTh>
                <LTh>Contact</LTh>
                <LTh>Certificates</LTh>
                {/* Hidden visually but must still have an accessible name,
                    or the Edit-link column is unnamed to a screen reader. */}
                <LTh>
                  <span className="sr-only">Actions</span>
                </LTh>
              </tr>
            </thead>
            <tbody>
              {crew.map((member) => (
                <tr key={member.id}>
                  <th
                    scope="row"
                    className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                  >
                    <NextLink href={`/crew/${member.id}`} className="text-accent hover:underline">
                      {member.name}
                    </NextLink>
                    {member.archived_at ? (
                      <div className="mt-1">
                        <LPill tone="neutral">Archived</LPill>
                      </div>
                    ) : null}
                  </th>
                  <LTd>{member.role ?? "—"}</LTd>
                  {/* Contact: the email if there is one, else the phone —
                      one line, not a two-line stack, because crew has no
                      separate "contact person" the way a client's own
                      contact_name/contact_email pair does. This person IS
                      the contact. */}
                  <LTd>{member.email ?? member.phone ?? "—"}</LTd>
                  <LTd>{member.certificates ?? "—"}</LTd>
                  <LTd numeric>
                    <NextLink
                      href={`/crew/${member.id}`}
                      aria-label={`Edit ${member.name}`}
                      className={lButtonClass({ variant: "outline", size: "sm" })}
                    >
                      Edit
                    </NextLink>
                  </LTd>
                </tr>
              ))}
            </tbody>
          </LTable>
        )}
      </LCard>
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shape as clients/page.tsx's own WarningIcon. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
