import "server-only";
import { createClient } from "@/lib/supabase/server";
import { formatDateRange } from "@/lib/format";
import type { ClientOption, TripOption } from "./expense-form";

type TripRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  client_id: string | null;
};

type ClientRow = {
  id: string;
  name: string;
  default_expense_treatment: string;
};

/**
 * Trips a receipt can be filed against, newest first. Every trip is
 * offered, including invoiced ones: Phase 5's `expenses_protect_billed_trip`
 * trigger is what refuses a change that would alter an already-billed
 * trip, and second-guessing it here would only hide legitimate cases
 * (attaching a late-arriving receipt to a trip that hasn't been invoiced
 * yet but shares the list).
 *
 * Each trip carries its client's name and `default_expense_treatment` —
 * the form uses these to DEFAULT (never force) a new expense's treatment
 * once a trip is picked, and to say out loud where that default came
 * from. HIGH 7: the client already answers this question on its own
 * record; the expense form used to ask again and hardcode "unassigned"
 * regardless.
 */
export async function loadTripOptions(): Promise<{
  trips: TripOption[];
  error: string | null;
}> {
  const supabase = await createClient();
  const [{ data, error }, { data: clientData }] = await Promise.all([
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, aircraft_ident, client_id")
      .order("starts_on", { ascending: false }),
    supabase.from("clients").select("id, name, default_expense_treatment"),
  ]);

  if (error) return { trips: [], error: error.message };

  // Resolved in memory rather than as a PostgREST embed: the embed's
  // return type resolves to `never` against the hand-authored types file
  // (same reason trips/page.tsx's client lookup and account.ts give), and
  // a pilot's client list is small enough that the join is free.
  const clientsById = new Map(
    ((clientData ?? []) as ClientRow[]).map((c) => [c.id, c])
  );

  const trips = ((data ?? []) as TripRow[]).map((trip) => {
    const client = trip.client_id ? clientsById.get(trip.client_id) : undefined;
    return {
      id: trip.id,
      label: `${formatDateRange(trip.starts_on, trip.ends_on)}${
        trip.aircraft_ident ? ` · ${trip.aircraft_ident}` : ""
      }`,
      // Carried so the form can DERIVE the expense's client from the trip
      // rather than asking twice. The database refuses any other pairing
      // (20260815130000's composite FK on (account_id, trip_id,
      // client_id)), so a Client field the pilot could set independently of
      // the trip would be a field that lies.
      clientId: trip.client_id,
      clientName: client?.name ?? null,
      defaultTreatment: client?.default_expense_treatment ?? null,
      // Carried as fields rather than parsed back out of `label`: the
      // receipt scanner matches a tail number read off an FBO invoice
      // against these to work out which trip the charge belongs to, and
      // that is not a decision to make by scraping a display string.
      aircraftIdent: trip.aircraft_ident,
      startsOn: trip.starts_on,
      endsOn: trip.ends_on,
    };
  });
  return { trips, error: null };
}

/**
 * Clients a trip-less cost can be attributed to, archived ones dropped.
 *
 * Archived is "don't offer this for new work", not "delete" -- an expense
 * already attributed to a client the pilot has since archived keeps that
 * attribution, and the form renders it by name from the trip or as
 * "Client no longer listed" rather than pretending it has none.
 *
 * A failed read returns its message rather than an empty list, so a caller
 * can say "couldn't load your clients" instead of showing a picker that
 * reads as "you have none" and pushing the pilot into leaving the cost
 * unattributed.
 */
export async function loadClientOptions(): Promise<{
  clients: ClientOption[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, archived_at")
    .order("name", { ascending: true });

  if (error) return { clients: [], error: error.message };

  const clients = ((data ?? []) as { id: string; name: string; archived_at: string | null }[])
    .filter((client) => !client.archived_at)
    .map((client) => ({ id: client.id, name: client.name }));
  return { clients, error: null };
}
