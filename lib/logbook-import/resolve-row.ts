import type { LogbookEntryFlightFields, LogbookRole, SimulatorDeviceType } from "@/app/(app)/logbook/db";
import type { ParsedRowValues } from "./types";

/**
 * The one function that turns a parsed row's possibly-unresolved values
 * into a real, insertable LogbookEntryFlightFields — or refuses to,
 * returning null. This is where "role must not be guessed" and "no
 * simulator device type must not be guessed" are enforced as CODE, not
 * just as a UI affordance: even if a caller skips the preview screen
 * entirely (a crafted request straight at confirmImport), a row with an
 * unresolved role or an unresolved required device type cannot become an
 * insert payload. Called on both sides of the wire — the preview UI uses
 * it to decide whether a row is ready to submit, and confirmImport
 * (app/(app)/logbook/import/actions.ts) calls it again server-side rather
 * than trusting that the client already did.
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
