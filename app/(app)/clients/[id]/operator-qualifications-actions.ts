"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";
import {
  OPERATOR_QUALIFICATION_REQUIREMENTS,
  LINE_CHECK_REQUIREMENT,
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
 * expires_on is never read from the form — the database trigger
 * (pilot.compute_operator_qualification_expiry) derives it for the three
 * regulated checks and passes through whatever already exists for every
 * other requirement, so there is nothing for this action to compute or
 * send. This keeps the 135.293/135.297/135.299/135.301 arithmetic in
 * exactly one place, matching every other derived value in this schema.
 */
export async function saveOperatorQualification(
  _prev: QualificationFormState,
  formData: FormData
): Promise<QualificationFormState> {
  const clientId = String(formData.get("client_id") ?? "");
  const requirement = String(formData.get("requirement") ?? "");
  const typeDesignator = optional(formData, "type_designator") ?? "";

  if (!UUID_RE.test(clientId)) {
    return { error: "That client isn't valid." };
  }
  if (!REQUIREMENT_VALUES.has(requirement)) {
    return { error: "That requirement isn't recognized." };
  }
  if (requirement === LINE_CHECK_REQUIREMENT && typeDesignator === "") {
    return {
      error: "A line check is type-specific — enter the aircraft type it was flown in.",
      values: { type_designator: typeDesignator },
    };
  }

  const completedOn = optionalDate(formData, "completed_on");
  if (completedOn === undefined) {
    return { error: "That completion date isn't valid.", values: { completed_on: String(formData.get("completed_on") ?? "") } };
  }

  const status = String(formData.get("status") ?? "not_started");
  const notes = optional(formData, "notes");

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
    return { error: friendlyDbError(selectError, "operator_qualifications.select") };
  }
  const existing = existingData as { id: string } | null;

  if (existing) {
    const payload: QualificationUpdate = {
      completed_on: completedOn,
      status: status as QualificationUpdate["status"],
      notes,
    };
    const { error, count } = await supabase
      .from("operator_qualifications")
      .update(payload as never, { count: "exact" })
      .eq("id", existing.id)
      .eq("account_id", account.id);
    if (error) return { error: friendlyDbError(error, "operator_qualifications.update") };
    if (count === 0) return { error: "Couldn't save that qualification." };
  } else {
    const payload: QualificationInsert = {
      account_id: account.id,
      client_id: clientId,
      requirement: requirement as QualificationInsert["requirement"],
      type_designator: typeDesignator,
      completed_on: completedOn,
      status: status as QualificationInsert["status"],
      notes,
    };
    const { error, count } = await supabase
      .from("operator_qualifications")
      .insert(payload as never, { count: "exact" });
    if (error) return { error: friendlyDbError(error, "operator_qualifications.insert") };
    if (count === 0) return { error: "Couldn't save that qualification." };
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
