"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";
import {
  OPERATOR_QUALIFICATION_REQUIREMENTS,
  LINE_CHECK_REQUIREMENT,
  DERIVED_EXPIRY_REQUIREMENTS,
  STATUS_OPTIONS,
} from "./operator-qualification-kinds";

type QualificationInsert = Database["pilot"]["Tables"]["operator_qualifications"]["Insert"];
type QualificationUpdate = Database["pilot"]["Tables"]["operator_qualifications"]["Update"];

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
 * Insert-or-update for a single (client, requirement, type_designator)
 * qualification record — the same lookup-then-branch shape
 * setClientRateOverride (rate-overrides-actions.ts) uses, for the same
 * reason: (account_id, client_id, requirement, type_designator) is what
 * IDENTIFIES a row (the migration's unique constraint), and the grant
 * withholds all three of those columns from UPDATE, so re-pointing any of
 * them has to be a delete-and-insert rather than a single upsert call.
 *
 * expires_on (H4): for the three trigger-derived requirements
 * (DERIVED_EXPIRY_REQUIREMENTS — competency_check_135_293, ipc_135_297,
 * line_check_135_299) this action never reads or sends it — the database
 * trigger (pilot.compute_operator_qualification_expiry) unconditionally
 * overwrites whatever it's handed for those three, so sending a
 * pilot-typed value would be pointless at best and misleading at worst
 * (it would flash briefly before the trigger's real answer replaced it).
 * This keeps the 135.293/135.297/135.299/135.301 arithmetic in exactly
 * one place, matching every other derived value in this schema. For
 * every OTHER requirement kind — the eight with no cited calendar-month
 * reg — expires_on IS read from the form and sent on both insert and
 * update, since for those it is (per the column comment) "whatever the
 * pilot enters directly", same as pilot.documents.expires_on. Before this
 * fix expires_on was unreachable for all eight non-derived kinds, so
 * insurance_approval and recurrent_training — the two rows a pilot most
 * needs a reminder on — could never appear in pilot.expirations at all.
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
  if (requirement === LINE_CHECK_REQUIREMENT && typeDesignator === "") {
    return {
      error: "A line check is type-specific — enter the aircraft type it was flown in.",
      values: echo,
    };
  }

  const completedOn = optionalDate(formData, "completed_on");
  if (completedOn === undefined) {
    return { error: "That completion date isn't valid.", values: echo };
  }

  // expires_on is only ever taken from the form for the non-derived
  // kinds — see the function comment. For the three derived kinds the
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

  const { data: existingData, error: selectError } = await supabase
    .from("operator_qualifications")
    .select("id")
    .eq("account_id", account.id)
    .eq("client_id", clientId)
    .eq("requirement", requirement)
    .eq("type_designator", typeDesignator)
    .maybeSingle();

  if (selectError) {
    return { error: friendlyDbError(selectError, "operator_qualifications.select"), values: echo };
  }
  const existing = existingData as { id: string } | null;

  if (existing) {
    const payload: QualificationUpdate = {
      completed_on: completedOn,
      status: status as QualificationUpdate["status"],
      notes,
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
 * Removes one line-check-by-type row. Only offered for line checks in the
 * panel — every other requirement is a fixed row a pilot clears by
 * setting status back to "Not started" rather than deleting, since there
 * is exactly one row per requirement for those and the panel always shows
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
