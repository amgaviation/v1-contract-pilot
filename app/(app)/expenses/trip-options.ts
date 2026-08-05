import "server-only";
import { createClient } from "@/lib/supabase/server";
import { formatDateRange } from "@/lib/format";
import type { TripOption } from "./expense-form";

type TripRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
};

/**
 * Trips a receipt can be filed against, newest first. Every trip is
 * offered, including invoiced ones: Phase 5's `expenses_protect_billed_trip`
 * trigger is what refuses a change that would alter an already-billed
 * trip, and second-guessing it here would only hide legitimate cases
 * (attaching a late-arriving receipt to a trip that hasn't been invoiced
 * yet but shares the list).
 */
export async function loadTripOptions(): Promise<{
  trips: TripOption[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trips")
    .select("id, starts_on, ends_on, aircraft_ident")
    .order("starts_on", { ascending: false });

  if (error) return { trips: [], error: error.message };

  const trips = ((data ?? []) as TripRow[]).map((trip) => ({
    id: trip.id,
    label: `${formatDateRange(trip.starts_on, trip.ends_on)}${
      trip.aircraft_ident ? ` · ${trip.aircraft_ident}` : ""
    }`,
  }));
  return { trips, error: null };
}
