import type { LogbookEntryFlightFields, LogbookRole, SimulatorDeviceType } from "@/app/(app)/logbook/db";
import type { ParsedRowValues } from "./types";

/**
 * The one function that turns a parsed row's possibly-unresolved values
 * into a real, insertable LogbookEntryFlightFields — or refuses to,
 * returning null. This is where "role must not be guessed" and "no
 * simulator device type must not be guessed" are enforced as UI-side
 * CODE, not just a disabled-button affordance: the preview UI
 * (app/(app)/logbook/import/import-workspace.tsx) calls this before it
 * will let a row be included in a confirm request, so a row with an
 * unresolved role or an unresolved required device type never makes it
 * into the payload from this client at all.
 *
 * That said, this function itself is NOT called server-side — grep finds
 * exactly one caller, import-workspace.tsx. The load-bearing defense
 * against a crafted request straight at confirmImport (bypassing this
 * client entirely) is the `validateRow` function in
 * app/(app)/logbook/import/actions.ts (at the time of writing:
 * actions.ts:257-328; that file is under active concurrent edit, so
 * treat the function name — not the line numbers — as the durable
 * pointer). `validateRow` independently re-derives the same two
 * guarantees against the raw payload: its `isRole` check
 * (actions.ts:260) rejects any row whose role isn't a real LogbookRole
 * (so a payload that skipped this function's null-role check is
 * refused, not defaulted), and its simulator-device-type check
 * (actions.ts:321) rejects simulator_time > 0 with no device type,
 * mirroring the schema's own CHECK constraint. Both functions enforce
 * the same rule from the same source values; they are not one function
 * calling the other.
 */
export function resolveRow(
  values: ParsedRowValues,
  overrides: {
    role: LogbookRole | null;
    simulatorDeviceType: SimulatorDeviceType | null;
  }
): LogbookEntryFlightFields | null {
  // Device type is resolved FIRST now: whether a role is required depends
  // on this entry being wholly simulator time, and a simulator entry is
  // not storable at all without a device type (logbook_entries_check2).
  let simulatorDeviceType = values.simulator_device_type;
  if ((values.simulator_time ?? 0) > 0 && !simulatorDeviceType) {
    simulatorDeviceType = overrides.simulatorDeviceType;
    if (!simulatorDeviceType) return null;
  }

  const role = values.role ?? overrides.role;
  if (!role) {
    // A WHOLLY-SIMULATOR entry legitimately has no crew role, and asking
    // for one has no correct answer — there is no aircraft to be pilot in
    // command of. It resolves rather than blocking. See
    // supabase/migrations/20260810020000_logbook_simulator_role_optional.sql
    // for the reasoning, and for the CHECK that stops this exemption ever
    // reaching an actual flight.
    if (isWhollySimulator(values) && simulatorDeviceType) {
      return { ...values, role: null, simulator_device_type: simulatorDeviceType };
    }
    return null;
  }

  return { ...values, role, simulator_device_type: simulatorDeviceType };
}

/**
 * True when every hour on this entry is simulator time — the one case in
 * which a logbook entry may carry no crew role.
 *
 * Mirrors the second arm of
 * logbook_entries_role_required_unless_simulator exactly. If that
 * constraint's shape ever changes, this is the other half to change with
 * it, and scripts/foreflight-import-verify.mjs asserts the pair agree.
 */
export function isWhollySimulator(values: {
  simulator_time: number | null;
  total_time: number;
}): boolean {
  const sim = values.simulator_time ?? 0;
  return sim > 0 && values.total_time === sim;
}
