"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";
import {
  OPERATOR_QUALIFICATION_REQUIREMENTS,
  TYPE_SPECIFIC_REQUIREMENTS,
  DERIVED_EXPIRY_REQUIREMENTS,
  STATUS_OPTIONS,
} from "./operator-qualification-kinds";

type QualificationInsert = Database["pilot"]["Tables"]["operator_qualifications"]["Insert"];
type QualificationUpdate = Database["pilot"]["Tables"]["operator_qualifications"]["Update"];
type ClientInsert = Database["pilot"]["Tables"]["clients"]["Insert"];

/**
 * State for the panel's inline "add an operator" form. `name` echoes what
 * was typed so a rejected submit does not blank it: React 19 resets an
 * uncontrolled form on every action dispatch, the error path included.
 */
export type OperatorFormState = {
  error: string | null;
  name?: string;
};

export type QualificationFormState = {
  error: string | null;
  saved?: boolean;
  values?: Record<string, string>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUIREMENT_VALUES = new Set(
  OPERATOR_QUALIFICATION_REQUIREMENTS.map((r) => r.value as string)
);

const STATUS_VALUES = new Set(STATUS_OPTIONS.map((s) => s.value as string));

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function optionalDate(formData: FormData, key: string): string | null | undefined {
  const value = optional(formData, key);
  if (value === null) return null;
  return isDate(value) ? value : undefined;
}

/**
 * Insert-or-update for a single qualification record.
 *
 * IDENTITY (20260807110000 correction — read the migration header before
 * changing this): only for the two TYPE_SPECIFIC_REQUIREMENTS
 * (competency_check_135_293b, ipc_135_297 — 135.293(b) is class/type-
 * specific, 135.297(e) rotates by type) does (account_id, client_id,
 * requirement, type_designator) identify the row; those are always
 * created fresh (never edited in place) via the panel's "add a ___" row,
 * matching setClientRateOverride's (rate-overrides-actions.ts)
 * lookup-then-branch shape. For every OTHER requirement — INCLUDING the
 * line check, which used to be type-specific and is not (135.299(a)
 * covers every type with one check) — the row is identified by
 * (account_id, client_id, requirement) alone, and type_designator is
 * just another editable field on it (informational for the line check;
 * always '' and untouched for the rest). Matching only on
 * (client_id, requirement) for those keeps the line check pinned to one
 * row even as its recorded type is corrected in place, instead of a
 * changed type value silently opening a second row.
 *
 * expires_on (H4): for the four trigger-derived requirements
 * (DERIVED_EXPIRY_REQUIREMENTS — written_test_135_293a,
 * competency_check_135_293b, ipc_135_297, line_check_135_299) this
 * action never reads or sends it — the database trigger
 * (pilot.compute_operator_qualification_expiry) unconditionally
 * overwrites whatever it's handed for those four, so sending a
 * pilot-typed value would be pointless at best and misleading at worst
 * (it would flash briefly before the trigger's real answer replaced it).
 * This keeps the 135.293/135.297/135.299/135.301 arithmetic in exactly
 * one place, matching every other derived value in this schema. For
 * every OTHER requirement kind — the seven with no cited calendar-month
 * reg — expires_on IS read from the form and sent on both insert and
 * update, since for those it is (per the column comment) "whatever the
 * pilot enters directly", same as pilot.documents.expires_on.
 */
export async function saveOperatorQualification(
  _prev: QualificationFormState,
  formData: FormData
): Promise<QualificationFormState> {
  const clientId = String(formData.get("client_id") ?? "");
  const requirement = String(formData.get("requirement") ?? "");
  const typeDesignator = optional(formData, "type_designator") ?? "";
  const status = String(formData.get("status") ?? "not_started");
  const notes = optional(formData, "notes");
  const rawCompletedOn = String(formData.get("completed_on") ?? "");
  const rawExpiresOn = String(formData.get("expires_on") ?? "");

  // M4: every failure path below echoes `values` — completed_on, status
  // and notes are all uncontrolled inputs in the row component (notes and
  // completed_on are plain defaultValue text/date fields; status is only
  // ever mirrored back through this same object), so any early return that
  // omits `values` loses whatever the pilot had typed there.
  const echo = {
    type_designator: typeDesignator,
    completed_on: rawCompletedOn,
    status,
    notes: notes ?? "",
    expires_on: rawExpiresOn,
  };

  if (!UUID_RE.test(clientId)) {
    return { error: "That client isn't valid.", values: echo };
  }
  if (!REQUIREMENT_VALUES.has(requirement)) {
    return { error: "That requirement isn't recognized.", values: echo };
  }
  if (!STATUS_VALUES.has(status)) {
    return { error: "That status isn't recognized.", values: echo };
  }
  if (TYPE_SPECIFIC_REQUIREMENTS.has(requirement) && typeDesignator === "") {
    return {
      error: "This check is class or type-specific. Enter the aircraft class or type it was flown in.",
      values: echo,
    };
  }

  const completedOn = optionalDate(formData, "completed_on");
  if (completedOn === undefined) {
    return { error: "That completion date isn't valid.", values: echo };
  }

  // expires_on is only ever taken from the form for the non-derived
  // kinds — see the function comment. For the four derived kinds the
  // trigger overwrites it regardless, so there's no reason to parse (or
  // validate) a value the database is going to replace anyway.
  const derived = DERIVED_EXPIRY_REQUIREMENTS.has(requirement);
  let expiresOn: string | null | undefined = null;
  if (!derived) {
    expiresOn = optionalDate(formData, "expires_on");
    if (expiresOn === undefined) {
      return { error: "That expiry date isn't valid.", values: echo };
    }
  }

  const { account } = await requireAccount(`/clients/${clientId}`);
  const supabase = await createClient();

  // IDENTITY (see the function comment): type-specific requirements are
  // matched on type_designator too, since a pilot can hold one row per
  // class/type. Every other requirement — including the line check,
  // whose type_designator is now purely informational — is matched on
  // (client_id, requirement) alone, so correcting the recorded type
  // updates the one existing row instead of opening a second one.
  const typeSpecific = TYPE_SPECIFIC_REQUIREMENTS.has(requirement);
  let existingQuery = supabase
    .from("operator_qualifications")
    .select("id")
    .eq("account_id", account.id)
    .eq("client_id", clientId)
    .eq("requirement", requirement);
  if (typeSpecific) {
    existingQuery = existingQuery.eq("type_designator", typeDesignator);
  }
  const { data: existingData, error: selectError } = await existingQuery.maybeSingle();

  if (selectError) {
    return { error: friendlyDbError(selectError, "operator_qualifications.select"), values: echo };
  }
  const existing = existingData as { id: string } | null;

  if (existing) {
    const payload: QualificationUpdate = {
      completed_on: completedOn,
      status: status as QualificationUpdate["status"],
      notes,
      // type_designator is only ever re-sent on UPDATE for the
      // non-type-specific kinds (in practice, only the line check's
      // fixed row has a form field that can change it) — for the two
      // type-specific kinds each row's type is fixed at creation and the
      // row component never renders an editable type field once
      // `existing` is set, so this is a no-op there.
      ...(typeSpecific ? {} : { type_designator: typeDesignator }),
      ...(derived ? {} : { expires_on: expiresOn }),
    };
    const { error, count } = await supabase
      .from("operator_qualifications")
      .update(payload as never, { count: "exact" })
      .eq("id", existing.id)
      .eq("account_id", account.id);
    if (error) return { error: friendlyDbError(error, "operator_qualifications.update"), values: echo };
    if (count === 0) return { error: "Couldn't save that qualification.", values: echo };
  } else {
    const payload: QualificationInsert = {
      account_id: account.id,
      client_id: clientId,
      requirement: requirement as QualificationInsert["requirement"],
      type_designator: typeDesignator,
      completed_on: completedOn,
      status: status as QualificationInsert["status"],
      notes,
      ...(derived ? {} : { expires_on: expiresOn }),
    };
    const { error, count } = await supabase
      .from("operator_qualifications")
      .insert(payload as never, { count: "exact" });
    if (error) return { error: friendlyDbError(error, "operator_qualifications.insert"), values: echo };
    if (count === 0) return { error: "Couldn't save that qualification.", values: echo };
  }

  revalidatePath(`/clients/${clientId}`);
  return { error: null, saved: true };
}

/**
 * Removes one competency-check- or IPC-by-type row (20260807110000: the
 * two TYPE_SPECIFIC_REQUIREMENTS — see the migration header for why
 * those two, and not the line check, are the class/type-repeatable
 * ones). Only offered for those in the panel — every other requirement,
 * including the line check now, is a fixed row a pilot clears by setting
 * status back to "Not started" rather than deleting, since there is
 * exactly one row per requirement for those and the panel always shows
 * it.
 */
export async function deleteOperatorQualification(
  id: string,
  clientId: string
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id) || !UUID_RE.test(clientId)) {
    return { error: "That record isn't valid." };
  }
  const { account } = await requireAccount(`/clients/${clientId}`);
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("operator_qualifications")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "operator_qualifications.delete") };
  if (count === 0) return { error: "Couldn't remove that record." };

  revalidatePath(`/clients/${clientId}`);
  return { error: null };
}

/**
 * ADD AN OPERATOR WITHOUT LEAVING THIS PANEL.
 *
 * THE SEQUENCE THIS EXISTS FOR. A contract pilot completes basic indoc for
 * an operator weeks before flying for them, and sometimes for one that
 * never sends a trip at all. pilot.operator_qualifications.client_id is
 * `not null` and correctly so (a qualification is held under a specific
 * operator's certificate), so recording that indoc has always needed a
 * pilot.clients row to point at. What was wrong was the ROUTE to one:
 * leave this screen, go to Clients, fill in a billing form with rates,
 * payment terms, a W-9 status and a chase schedule, then come back. Every
 * one of those fields is a question about billing somebody the pilot is
 * not billing.
 *
 * SO THIS ASKS FOR A NAME. pilot.clients requires exactly that; every
 * other column is nullable or has a default (terms 30, expense treatment
 * 'unassigned', W-9 'not_requested', rates null). The record is created
 * with you_invoice = false (20260815120000) so it never reaches an invoice
 * or estimate picker, the A/R aging, a statement or the unbilled queue,
 * and the pilot flips that themselves the day the operator sends paid
 * work.
 *
 * WHY IT REDIRECTS. Qualifications are per operator, and this panel renders
 * ONE operator's, so the new operator's own panel is where the pilot is
 * going. What they no longer do is stop at a billing form on the way.
 */
export async function createOperatorCounterparty(
  _prev: OperatorFormState,
  formData: FormData
): Promise<OperatorFormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the operator a name.", name: "" };

  const { account } = await requireAccount("/clients");
  const supabase = await createClient();

  const payload: ClientInsert = {
    account_id: account.id,
    name,
    // The whole point: created as somebody you do not bill. Reversible on
    // the client form above the moment that changes.
    you_invoice: false,
  };
  const { data, error } = await supabase
    .from("clients")
    .insert(payload as never)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: friendlyDbError(error, "clients.insert"), name };
  }
  const created = data as { id: string } | null;
  // PostgREST returns no error for an insert that produced no readable
  // row. Reporting success and redirecting nowhere would be a lie, and
  // redirecting to an id we do not have is not possible.
  if (!created) return { error: "Couldn't add that operator. Try again.", name };

  revalidatePath("/clients");
  redirect(`/clients/${created.id}`);
}
