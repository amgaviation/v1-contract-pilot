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
  const role = values.role ?? overrides.role;
  if (!role) return null;

  let simulatorDeviceType = values.simulator_device_type;
  if ((values.simulator_time ?? 0) > 0 && !simulatorDeviceType) {
    simulatorDeviceType = overrides.simulatorDeviceType;
    if (!simulatorDeviceType) return null;
  }

  return { ...values, role, simulator_device_type: simulatorDeviceType };
}
