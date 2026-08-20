"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { looksLikeEmail } from "@/lib/email/address";
import type { Database } from "@/lib/supabase/database.types";

type CrewInsert = Database["pilot"]["Tables"]["crew_members"]["Insert"];
type CrewUpdate = Database["pilot"]["Tables"]["crew_members"]["Update"];
/**
 * What the form produces: every writable column except account_id, which
 * comes from the session. Same reasoning as clients/actions.ts's
 * ClientFields — typing the parse result this way (rather than as Update)
 * keeps `name` required at compile time.
 */
type CrewFields = Omit<CrewInsert, "account_id">;

/**
 * `values` echoes what was submitted so the form can repopulate itself.
 * React 19 resets an uncontrolled form on EVERY action dispatch, the error
 * path included — without this, one bad character in the email field
 * blanks every field the pilot just typed. Same shape as
 * clients/actions.ts's ClientFormState.
 */
export type CrewFormState = {
  error: string | null;
  values?: Record<string, string>;
};

/** Fields whose submitted text is echoed back on a failed submit. */
const CREW_FIELDS = ["name", "role", "email", "phone", "certificates", "notes"] as const;

function echo(formData: FormData) {
  const out: Record<string, string> = {};
  for (const field of CREW_FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trims, and turns an empty string into NULL rather than storing "". */
function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

type ParsedCrew = {
  values: CrewFields;
  error: string | null;
};

/**
 * Shared parse + validate for create and edit. Every field here is free
 * text (no invented enums — see the plan this feature shipped from), so
 * there is nothing to validate beyond "is there a name" and "does the
 * email look like one". The database's own char_length CHECKs are the
 * real bound on every field's length; a value that trips one comes back
 * through friendlyDbError's generic 23514 sentence rather than being
 * re-validated here, same as every other free-text field in this product.
 */
function parseCrewForm(formData: FormData): ParsedCrew {
  const empty = { values: {} as CrewFields, error: null as string | null };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ...empty, error: "Give the crew member a name." };

  // Same looksLikeEmail guard clients/actions.ts uses on contact_email —
  // deliberately permissive, a typo guard rather than an RFC 5322 parser.
  const email = optional(formData, "email");
  if (email !== null && !looksLikeEmail(email)) {
    return { ...empty, error: "That email doesn't look like an email address." };
  }

  return {
    error: null,
    values: {
      name,
      role: optional(formData, "role"),
      email,
      phone: optional(formData, "phone"),
      certificates: optional(formData, "certificates"),
      notes: optional(formData, "notes"),
    },
  };
}

export async function createCrewMember(
  _prev: CrewFormState,
  formData: FormData
): Promise<CrewFormState> {
  const { account } = await requireAccount("/crew/new");
  const { values, error } = parseCrewForm(formData);
  if (error) return { error, values: echo(formData) };

  const supabase = await createClient();
  // account_id is set from the session, never from the form. RLS's WITH
  // CHECK would reject another tenant's id anyway, but not accepting it at
  // all means there is no input to get wrong.
  //
  // Typed as Insert before the cast so a mistyped column name is a compile
  // error — `as never` alone would silently disable that check, and it is
  // only needed because recent supabase-js resolves .insert() against this
  // hand-authored types file to `never`.
  const payload: CrewInsert = { ...values, account_id: account.id };
  const { error: insertError } = await supabase
    .from("crew_members")
    .insert(payload as never);

  if (insertError) {
    return {
      error: friendlyDbError(insertError, "crew_members.insert"),
      values: echo(formData),
    };
  }

  revalidatePath("/crew");
  redirect("/crew");
}

export async function updateCrewMember(
  _prev: CrewFormState,
  formData: FormData
): Promise<CrewFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id || !UUID_RE.test(id)) {
    return { error: "Missing crew member id.", values: echo(formData) };
  }

  const { account } = await requireAccount(`/crew/${id}`);
  const { values, error } = parseCrewForm(formData);
  if (error) return { error, values: echo(formData) };

  const supabase = await createClient();
  // The account_id filter is defence in depth, NOT the boundary — same
  // note as clients/actions.ts's updateClientRecord. RLS's USING clause is
  // what actually scopes this to the caller's tenant, and the UPDATE
  // grant withholds account_id so a row cannot be re-parented.
  const payload: CrewUpdate = { ...values };
  const { error: updateError, count } = await supabase
    .from("crew_members")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (updateError) {
    return {
      error: friendlyDbError(updateError, "crew_members.update"),
      values: echo(formData),
    };
  }
  // PostgREST returns 200 with no error for a write that matched nothing
  // (a stale tab posting an id archived or deleted elsewhere) — "no
  // error" is not "it saved".
  if (count === 0) {
    return { error: "That crew member no longer exists.", values: echo(formData) };
  }

  revalidatePath("/crew");
  revalidatePath(`/crew/${id}`);
  redirect("/crew");
}

/**
 * Archive, not delete. pilot.crew_members carries no DELETE policy or
 * grant at all (see the migration's header) — a crew record is history
 * from the day it exists, not only once something references it.
 */
export async function setCrewArchived(
  id: string,
  archived: boolean
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That crew member no longer exists." };

  const { account } = await requireAccount("/crew");

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("crew_members")
    .update(
      { archived_at: archived ? new Date().toISOString() : null } satisfies CrewUpdate as never,
      { count: "exact" }
    )
    .eq("id", id)
    .eq("account_id", account.id);

  // Returned rather than thrown: this runs inside a useTransition on the
  // client, where a throw is swallowed and the button just appears to do
  // nothing.
  if (error) return { error: friendlyDbError(error, "crew_members.archive") };
  // Zero rows matched: the row is not the caller's, or is already gone —
  // reporting success here would be a lie.
  if (count === 0) return { error: "That crew member no longer exists." };

  revalidatePath("/crew");
  revalidatePath(`/crew/${id}`);
  return { error: null };
}

/**
 * DELETE, alongside archive rather than instead of it.
 *
 * Archive is still the right default and stays: a crew member who flew
 * with you last year belongs in your records even after they stop showing
 * up in pickers. Delete is for the other case — the duplicate row, the
 * name typed into the wrong form — where keeping it is not history, it is
 * clutter, and archiving it just moves the clutter one click away.
 *
 * Safe to offer here in a way it is not for aircraft or clients: nothing
 * in the schema references pilot.crew_members, so this removes exactly
 * the row asked for and nothing else. The DELETE policy and grant arrive
 * in 20260820100000.
 */
export async function deleteCrewMember(id: string): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That crew member no longer exists." };

  const { account } = await requireAccount("/crew");

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("crew_members")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "crew_members.delete") };
  // Zero rows matched: not the caller's row, or already gone. Reporting
  // success here would be a lie.
  if (count === 0) return { error: "That crew member no longer exists." };

  revalidatePath("/crew");
  revalidatePath(`/crew/${id}`);
  return { error: null };
}
