"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents, parseTenth } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { looksLikeEmail } from "@/lib/email/address";
import type { ClientOperatingRule } from "@/lib/operating-rule";
import {
  REMINDER_AFTER_DAYS,
  REMINDER_BEFORE_DAYS,
} from "@/lib/reminders/policy";
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
  "operating_rule",
  // 20260813130000. Posted as comma-separated day lists and a small set of
  // scalars — see parseReminderDays and parseLateFee below.
  "reminder_before_due",
  "reminder_on_due",
  "reminder_after_due",
  "late_fee_kind",
  "late_fee_flat",
  "late_fee_rate_percent",
  "late_fee_grace_days",
  "late_fee_note_on_reminders",
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
// 20260807130000. 'unspecified' stays the fallback — matches the
// column's own DEFAULT, so a value this form can't recognize behaves the
// same way an absent one already does (same reasoning as MINIMUM_BASES).
/**
 * Which KIND of late fee, if any. Not a stored column — it decides which of
 * the two mutually-exclusive fee columns gets a value (see parseClientForm).
 * 'none' is the fallback, matching both columns' NULL default: a value this
 * form cannot recognise behaves exactly like an absent one.
 */
const LATE_FEE_KINDS = ["none", "flat", "rate"] as const;

const OPERATING_RULES: readonly ClientOperatingRule[] = [
  "unspecified",
  "part_91",
  "part_135",
  "both",
];

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

/**
 * A comma-separated day list from the reminder checkboxes ("3,7") to the
 * integer array the column holds.
 *
 * Posted as one hidden input rather than as repeated checkbox inputs for the
 * reason client-form.tsx's Select comment already sets out at length: React 19
 * resets an uncontrolled form on every action dispatch, so a control whose
 * state lives in the DOM loses it on a rejected submit. One controlled hidden
 * input per group survives the reset and echoes back.
 *
 * SILENTLY DROPS anything not in the offered set rather than erroring. The set
 * is fixed and rendered as checkboxes, so an out-of-range value did not come
 * from a pilot mis-typing — it came from a crafted post or a stale tab, and
 * the honest response to either is to store the part that is real. The
 * database CHECK is the actual boundary and would reject the rest anyway.
 */
function parseReminderDays(
  formData: FormData,
  key: string,
  allowed: readonly number[]
): number[] {
  return String(formData.get(key) ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isInteger(day) && allowed.includes(day))
    .filter((day, index, all) => all.indexOf(day) === index)
    .sort((a, b) => a - b);
}

/**
 * A percent like "1.5" to basis points, bounded at 5%/month.
 *
 * Same shape as the invoice tax parser (invoices/actions.ts's
 * parsePercentToBps) and for the same reason: percent is what a pilot reads
 * off their own agreement, and basis points are what the column stores so no
 * float ever touches money. `undefined` means "that isn't a number I can use",
 * distinct from `null`, which means "no rate agreed".
 */
function parseRateToBps(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const bps = Math.round(Number(text) * 100);
  if (!Number.isInteger(bps) || bps <= 0 || bps > 500) return undefined;
  return bps;
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

  // THE LATE FEE, AND THE ONE SHAPE THE DATABASE REFUSES.
  //
  // A flat fee and a rate are mutually exclusive by CHECK, so the form asks
  // WHICH KIND rather than offering two boxes and hoping. Reading the kind
  // here — instead of "whichever box has something in it" — is what makes the
  // impossible state unreachable from this action: exactly one of the two is
  // ever non-null, whatever the other box happens to contain.
  const lateFeeKind = oneOf(formData, "late_fee_kind", LATE_FEE_KINDS, "none");
  const lateFeeFlat = parseDollarsToCents(String(formData.get("late_fee_flat") ?? ""));
  if (lateFeeKind === "flat" && (lateFeeFlat === undefined || !lateFeeFlat)) {
    return {
      ...empty,
      error: "A flat late fee needs an amount, like 50 or 50.00. Choose \"No late fee\" if you haven't agreed one.",
    };
  }
  const lateFeeBps = parseRateToBps(String(formData.get("late_fee_rate_percent") ?? ""));
  if (lateFeeKind === "rate" && (lateFeeBps === undefined || lateFeeBps === null)) {
    return {
      ...empty,
      error:
        "A monthly late fee rate must be a percent like 1.5, up to 5%. Choose \"No late fee\" if you haven't agreed one.",
    };
  }

  const graceRaw = String(formData.get("late_fee_grace_days") ?? "").trim();
  const graceDays = graceRaw === "" ? 0 : Number(graceRaw);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90) {
    return {
      ...empty,
      error: "The late fee grace period must be a whole number of days, 0 to 90.",
    };
  }

  // The note can only be on when there is something agreed to state. The
  // database CHECK says the same thing; refusing it here means the pilot gets
  // a sentence instead of "Some of those values aren't valid together."
  const noteOnReminders =
    lateFeeKind !== "none" &&
    String(formData.get("late_fee_note_on_reminders") ?? "") === "1";

  // contact_email is the address a platform-sent invoice actually goes to
  // (see the form's own helper text) — a malformed value here was only
  // ever discovered at send time, as a delivery error far from where it
  // was typed. looksLikeEmail is this codebase's one shape check for an
  // address column (lib/email/address.ts, already used the same way by
  // settings/profile-actions.ts and lib/reminders/run.ts) — deliberately
  // permissive, a typo guard rather than an RFC 5322 parser.
  const contactEmail = optional(formData, "contact_email");
  if (contactEmail !== null && !looksLikeEmail(contactEmail)) {
    return {
      ...empty,
      error: "That contact email doesn't look like an email address.",
    };
  }

  return {
    error: null,
    values: {
      name,
      reminder_before_due: parseReminderDays(
        formData,
        "reminder_before_due",
        REMINDER_BEFORE_DAYS
      ),
      reminder_on_due: String(formData.get("reminder_on_due") ?? "") === "1",
      reminder_after_due: parseReminderDays(
        formData,
        "reminder_after_due",
        REMINDER_AFTER_DAYS
      ),
      late_fee_flat_cents: lateFeeKind === "flat" ? (lateFeeFlat ?? null) : null,
      late_fee_bps_per_month: lateFeeKind === "rate" ? (lateFeeBps ?? null) : null,
      late_fee_grace_days: graceDays,
      late_fee_note_on_reminders: noteOnReminders,
      contact_name: optional(formData, "contact_name"),
      contact_email: contactEmail,
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
      operating_rule: oneOf(formData, "operating_rule", OPERATING_RULES, "unspecified"),
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
  // STAMP THE W-9 DATES ON THE TRANSITION, because nothing else ever did.
  // pilot.clients.w9_sent_at and w9_received_at are granted for insert and
  // update and are READ by the Overview's "Needs attention" queue — which
  // renders "Requested —" for every outstanding W-9, forever, because no
  // code path in the product has ever written either column. A date the
  // pilot can see is the difference between "I asked them" and "I asked
  // them five weeks ago", which is the entire reason that queue item
  // exists.
  //
  // Read the stored status first so the stamp lands on the TRANSITION
  // rather than on every save — re-saving an unrelated field must not
  // reset the clock on a request that went out weeks ago.
  const { data: priorRow } = await supabase
    .from("clients")
    .select("w9_status")
    .eq("id", id)
    .eq("account_id", account.id)
    .maybeSingle();
  const priorW9 = (priorRow as { w9_status: string | null } | null)?.w9_status ?? null;
  const nextW9 = values.w9_status ?? null;
  const nowIso = new Date().toISOString();

  const payload: ClientUpdate = {
    ...values,
    ...(nextW9 === "requested" && priorW9 !== "requested" ? { w9_sent_at: nowIso } : {}),
    ...(nextW9 === "on_file" && priorW9 !== "on_file" ? { w9_received_at: nowIso } : {}),
  };
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
