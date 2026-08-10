import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The pilot's registered airframes, for every screen that asks them to
 * type a tail number.
 *
 * This is the other half of pilot.aircraft
 * (supabase/migrations/20260810110000_aircraft_registry.sql). A registry
 * that nothing reads is a form a pilot fills in once and never benefits
 * from; the point of registering an airframe is that the NEXT trip and the
 * next logbook entry offer it back instead of asking for it again. The
 * plan's own note on the gap was "retyped on every trip and every entry,
 * with no autocomplete".
 *
 * Shared rather than local to one feature directory because trips and the
 * logbook both need it and must offer the SAME list — a fleet that differs
 * between two screens is worse than no fleet.
 */

export type FleetOption = {
  tailNumber: string;
  typeDesignator: string | null;
  makeModel: string | null;
};

/**
 * A working pilot's fleet is single digits; a busy freelancer's is a
 * couple of dozen. This is a datalist, not a report — past this many the
 * browser's own filtering is doing the work anyway.
 */
const LIMIT = 200;

/**
 * Active airframes only. A retired one still gives its history a type
 * through the read-time join, but offering it as a suggestion for a flight
 * flown next week is exactly what archiving is for.
 *
 * Returns [] on any failure. A suggestion list is an affordance: if it
 * cannot be built, the field is still a plain text box that accepts
 * anything, which is what it was before this existed. Failing the whole
 * page over an autocomplete would be the wrong trade.
 */
export async function loadFleetOptions(): Promise<FleetOption[]> {
  const supabase = await createClient();
  // pilot.aircraft is not in the hand-authored database.types.ts — see
  // app/(app)/logbook/db.ts for why adding it there is the thing that
  // breaks supabase-js. Same narrow escape hatch, same discipline: the row
  // shape is asserted below and nothing untyped leaves this function.
  const from = (supabase as unknown as { from: (t: string) => AnyQuery }).from;
  const { data, error } = await from
    .call(supabase, "aircraft")
    .select("tail_number, type_designator, make_model")
    .is("archived_at", null)
    .order("tail_key", { ascending: true })
    .limit(LIMIT);

  if (error || !data) return [];

  return (
    data as {
      tail_number: string;
      type_designator: string | null;
      make_model: string | null;
    }[]
  ).map((row) => ({
    tailNumber: row.tail_number,
    typeDesignator: row.type_designator,
    makeModel: row.make_model,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;
