"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents, parseTenth } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

type ClientInsert = Database["pilot"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["pilot"]["Tables"]["clients"]["Update"];
/**
 * What the form produces: every writable column except account_id, which
 * comes from the session. Typing the parse result this way rather than as
 * Update means the compiler still requires `name` — an Update makes every
 * field optional, which would let a missing required column through.
 */
type ClientFields = Omit<ClientInsert, "account_id">;

/**
 * `values` echoes what was submitted so the form can repopulate itself.
 * React 19 resets an uncontrolled form on EVERY action dispatch, the
 * error path included — without this, one bad character in the day rate
 * blanks all seventeen fields the pilot just filled in.
 */
export type ClientFormState = {
  error: string | null;
  values?: Record<string, string>;
};

/** Fields whose submitted text is echoed back on a failed submit. */
const CLIENT_FIELDS = [
  "name",
  "contact_name",
  "contact_email",
  "contact_phone",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "country",
  "default_day_rate",
  "default_per_diem",
  "default_travel_day_rate",
  "payment_terms_days",
  "default_expense_treatment",
  "per_diem_mode",
  "minimum_days",
  "minimum_basis",
  "cancellation_policy_note",
  "w9_status",
  "notes",
] as const;

function echo(formData: FormData) {
  const out: Record<string, string> = {};
  for (const field of CLIENT_FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXPENSE_TREATMENTS = ["rebill", "deduct", "unassigned"] as const;
const W9_STATUSES = ["not_requested", "requested", "on_file"] as const;
const PER_DIEM_MODES = ["per_diem", "receipts"] as const;
// Bug fix: minimum_days used to have exactly one meaning — a per-trip
// floor — because that was the only basis createInvoiceDraft ever applied
// it under. A pilot on a monthly guarantee had nowhere to say so, and
// typed the guaranteed number into this same field, which produced one
// top-up line per trip instead of one per month (see
// supabase/migrations/20260807040000_client_minimum_basis.sql for the
// full story). 'per_trip' stays the fallback here too — matches the
// column's own DEFAULT, so a value this form can't recognize behaves the
// same way an absent one already does.
const MINIMUM_BASES = ["per_trip", "per_month"] as const;

/** Trims, and turns an empty string into NULL rather than storing "". */
function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

function oneOf<T extends readonly string[]>(
  formData: FormData,
  key: string,
  allowed: T,
  fallback: T[number]
): T[number] {
  const value = String(formData.get(key) ?? "");
  return (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

type ParsedClient = {
  values: ClientFields;
  error: string | null;
};

/**
 * Shared parse + validate for create and edit. The database enforces the
 * real constraints (non-negative money, the treatment and W-9
 * vocabularies, tenant scoping) — this exists so a typo comes back as a
 * sentence instead of a Postgres error string, not as the security
 * boundary. That boundary is RLS plus the column-scoped UPDATE grant.
 */
function parseClientForm(formData: FormData): ParsedClient {
  const empty = { values: {} as ClientFields, error: null as string | null };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ...empty, error: "Give the client a name." };

  const dayRate = parseDollarsToCents(String(formData.get("default_day_rate") ?? ""));
  if (dayRate === undefined) {
    return { ...empty, error: "Day rate must be an amount like 1500 or 1500.00." };
  }
  const perDiem = parseDollarsToCents(String(formData.get("default_per_diem") ?? ""));
  if (perDiem === undefined) {
    return { ...empty, error: "Per diem must be an amount like 75 or 75.00." };
  }
  // A travel day is a day spent getting to or from the airplane rather
  // than flying it, and it is commonly billed at a lower rate than a
  // flight day. Phase 5 drafts a separate `travel_day` invoice line from
  // it, so leaving it unset here would silently invoice those days at
  // nothing.
  const travelRate = parseDollarsToCents(
    String(formData.get("default_travel_day_rate") ?? "")
  );
  if (travelRate === undefined) {
    return { ...empty, error: "Travel day rate must be an amount like 900 or 900.00." };
  }
  if ((dayRate ?? 0) < 0 || (perDiem ?? 0) < 0 || (travelRate ?? 0) < 0) {
    return { ...empty, error: "Rates can't be negative." };
  }

  const termsRaw = String(formData.get("payment_terms_days") ?? "").trim();
  const terms = termsRaw === "" ? 30 : Number(termsRaw);
  if (!Number.isInteger(terms) || terms < 0) {
    return { ...empty, error: "Payment terms must be a whole number of days." };
  }

  // numeric(5,1): one decimal place, and Postgres would silently round a
  // second one rather than refuse it — see parseTenth. Blank is a valid
  // "no trip minimum agreed", not zero. Bounded at 999 to match the
  // database CHECK added by 20260807020000 — see that migration's
  // section 7 for why the bound has to live in both places.
  //
  // F4: "trip minimum," not "contract minimum" — see client-form.tsx's
  // comment on the same field for why the old name was the ambiguous
  // reading.
  const minimumDays = parseTenth(String(formData.get("minimum_days") ?? ""), {
    max: 999,
    allowBlank: true,
  });
  if (minimumDays === undefined) {
    return {
      ...empty,
      error: "Trip minimum must be a number of days with at most one decimal place, like 2 or 2.5.",
    };
  }

  return {
    error: null,
    values: {
      name,
      contact_name: optional(formData, "contact_name"),
      contact_email: optional(formData, "contact_email"),
      contact_phone: optional(formData, "contact_phone"),
      address_line1: optional(formData, "address_line1"),
      address_line2: optional(formData, "address_line2"),
      city: optional(formData, "city"),
      state: optional(formData, "state"),
      postal_code: optional(formData, "postal_code"),
      country: optional(formData, "country"),
      default_day_rate_cents: dayRate,
      default_per_diem_cents: perDiem,
      default_travel_day_rate_cents: travelRate,
      payment_terms_days: terms,
      default_expense_treatment: oneOf(
        formData,
        "default_expense_treatment",
        EXPENSE_TREATMENTS,
        "unassigned"
      ),
      per_diem_mode: oneOf(formData, "per_diem_mode", PER_DIEM_MODES, "receipts"),
      minimum_days: minimumDays,
      minimum_basis: oneOf(formData, "minimum_basis", MINIMUM_BASES, "per_trip"),
      cancellation_policy_note: optional(formData, "cancellation_policy_note"),
      w9_status: oneOf(formData, "w9_status", W9_STATUSES, "not_requested"),
      notes: optional(formData, "notes"),
    },
  };
}

export async function createClientRecord(
  _prev: ClientFormState,
  formData: FormData
): Promise<ClientFormState> {
  const { account } = await requireAccount("/clients/new");
  const { values, error } = parseClientForm(formData);
  if (error) return { error, values: echo(formData) };

  const supabase = await createClient();
  // account_id is set from the session, never from the form. RLS's WITH
  // CHECK would reject another tenant's id anyway, but not accepting it
  // at all means there is no input to get wrong.
  //
  // Typed as Insert before the cast so a mistyped column name is a
  // compile error — `as never` alone would silently disable that check,
  // and it is only needed because recent supabase-js resolves .insert()
  // against this hand-authored types file to `never`.
  const payload: ClientInsert = { ...values, account_id: account.id };
  const { error: insertError } = await supabase
    .from("clients")
    .insert(payload as never);

  if (insertError) {
    return { error: friendlyDbError(insertError, "clients.insert"), values: echo(formData) };
  }

  revalidatePath("/clients");
  redirect("/clients");
}

export async function updateClientRecord(
  _prev: ClientFormState,
  formData: FormData
): Promise<ClientFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id || !UUID_RE.test(id)) {
    return { error: "Missing client id.", values: echo(formData) };
  }

  const { account } = await requireAccount(`/clients/${id}`);
  const { values, error } = parseClientForm(formData);
  if (error) return { error, values: echo(formData) };

  const supabase = await createClient();
  // The account_id filter is defence in depth, NOT the boundary. RLS's
  // USING clause is what actually scopes this to the caller's tenant, and
  // the UPDATE grant withholds account_id so a row cannot be re-parented.
  // The redundant filter is here because these actions take a raw id from
  // a public endpoint, and a future migration that loosened the policy
  // would otherwise turn that into a cross-tenant write with nothing in
  // the application layer to refuse it.
  const payload: ClientUpdate = values;
  const { error: updateError, count } = await supabase
    .from("clients")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (updateError) {
    return { error: friendlyDbError(updateError, "clients.update"), values: echo(formData) };
  }
  // PostgREST returns 200 with no error for a write that matched nothing
  // (a stale tab posting an id archived or deleted elsewhere) — "no
  // error" is not "it saved".
  if (count === 0) {
    return { error: "That client no longer exists.", values: echo(formData) };
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  redirect("/clients");
}

/**
 * Archive, not delete. `pilot.trips` references a client with ON DELETE
 * RESTRICT, so deleting one that has ever flown a trip fails at the
 * database — correctly, since it would orphan the billing history. A
 * pilot who is "done with" a client wants it out of their pickers, which
 * is what archived_at does.
 */
export async function setClientArchived(
  id: string,
  archived: boolean
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That client no longer exists." };

  const { account } = await requireAccount("/clients");

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("clients")
    .update(
      { archived_at: archived ? new Date().toISOString() : null } satisfies ClientUpdate as never,
      { count: "exact" }
    )
    .eq("id", id)
    .eq("account_id", account.id);

  // Returned rather than thrown: this runs inside a useTransition on the
  // client, where a throw is swallowed and the button just appears to do
  // nothing.
  if (error) return { error: friendlyDbError(error, "clients.archive") };
  // Zero rows matched: the row is not the caller's, or is already gone —
  // reporting success here would be a lie.
  if (count === 0) return { error: "That client no longer exists." };

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { error: null };
}
