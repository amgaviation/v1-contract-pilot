import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";

/**
 * THE COMMAND PALETTE'S RECORD SEARCH — clients, invoices, trips, by the
 * fields a pilot actually types: a client name, an invoice number, or the
 * ICAO pair of a leg they flew. Backs app/(app)/command-palette.tsx's
 * "records" layer; the "navigation" layer (sections/Settings/Help) never
 * calls this route at all, it is filtered client-side by cmdk.
 *
 * AUTH AND SCOPING. There is no service-role client here — this uses the
 * cookie-bound `createClient()` (lib/supabase/server.ts), the same one
 * every page in app/(app) reads through, so every query below is subject
 * to the SAME Row Level Security as the pages it stands in for: RLS scopes
 * `pilot.clients` / `pilot.invoices` / `pilot.trips` / `pilot.trip_legs` to
 * the caller's own account_id, so there is no explicit `.eq("account_id",
 * …)` anywhere below, deliberately — the same pattern clients/page.tsx and
 * trips/page.tsx already use ("RLS scopes this to the caller's tenant; no
 * account_id filter is needed or wanted here"). A signed-out request has
 * no session for RLS to key off, so it is refused with 401 before any
 * query runs, rather than relying on RLS to return zero rows for it.
 *
 * NEVER THROWS HTML. A page's data-fetch failure degrades to a Callout on
 * an otherwise-rendered page; this route has no page around it, so a
 * failed Supabase call must not become a Next.js 500 HTML error page
 * rendered inside the palette's result list. Every catch path below
 * resolves to JSON with `error: true` and empty arrays — the palette reads
 * that flag and shows "Search couldn't run" rather than "No results",
 * which would otherwise read as "you searched, and there is nothing",
 * a different and wrong claim when the truth is the search itself failed.
 */

type ClientRow = Pick<
  Database["pilot"]["Tables"]["clients"]["Row"],
  "id" | "name" | "archived_at" | "contact_name"
>;
type InvoiceRow = Pick<
  Database["pilot"]["Tables"]["invoices"]["Row"],
  "id" | "client_id" | "invoice_number" | "status" | "issued_on" | "due_on"
>;
type TripRow = Pick<
  Database["pilot"]["Tables"]["trips"]["Row"],
  "id" | "client_id" | "status" | "starts_on" | "aircraft_ident"
>;
type LegRow = Pick<
  Database["pilot"]["Tables"]["trip_legs"]["Row"],
  "trip_id" | "from_icao" | "to_icao" | "leg_date"
>;

export type CommandSearchResult = {
  href: string;
  label: string;
  sublabel: string;
};

export type CommandSearchResponse = {
  error: boolean;
  clients: CommandSearchResult[];
  invoices: CommandSearchResult[];
  trips: CommandSearchResult[];
};

/** Up to this many rows per entity type land in the palette — a keyboard
 *  search picker, not a report; past this a pilot should open the full
 *  list and filter there instead. */
const PER_TYPE_LIMIT = 8;
/** A generous ceiling on the intermediate ICAO-leg and client-id lookups
 *  this route does before it dedupes down to PER_TYPE_LIMIT — enough
 *  headroom that a busy tenant's real data never truncates the FIRST pass,
 *  while still bounding a single request's Data API round trips. */
const LOOKUP_LIMIT = 20;
/** Below this the query is too short to be worth a round trip — a single
 *  keystroke against a client-name ilike would return most of the list. */
const MIN_QUERY_LENGTH = 2;

const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Partially paid",
  paid: "Paid",
  void: "Void",
};

const TRIP_STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  canceled: "Canceled",
};

const EMPTY_RESPONSE: Omit<CommandSearchResponse, "error"> = {
  clients: [],
  invoices: [],
  trips: [],
};

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No session, no tenant to scope RLS to — refused outright rather than
  // let five queries run and return empty by RLS accident. Mirrors
  // requireAccount's redirect-to-login for a page; a route handler cannot
  // redirect a fetch() call, so this is the API equivalent: 401 JSON.
  if (!user) {
    return NextResponse.json<CommandSearchResponse>(
      { error: true, ...EMPTY_RESPONSE },
      { status: 401 }
    );
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json<CommandSearchResponse>({ error: false, ...EMPTY_RESPONSE });
  }
  // ilike's own wildcard characters in the pilot's typed query would change
  // what "contains q" means (a stray "%" or "_" turns into a wildcard
  // instead of a literal character) — escaped so the match stays literal
  // substring search, the only thing a pilot typing into a search box
  // expects "%" or "_" to do.
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;

  try {
    // PASS 1 — the text matches that can run with no dependency on one
    // another: client name, invoice number, and leg ICAOs in EITHER
    // direction. The ICAO match is two separate ilike queries rather than
    // one `.or("from_icao.ilike...,to_icao.ilike...")` — PostgREST's `or`
    // filter splits its argument on top-level commas, and a pilot's typed
    // query is not guaranteed comma-free (a copy-pasted "KTEB, KVNY" is a
    // plausible search), which would silently mis-parse the filter. Two
    // plain ilike queries have no such edge case.
    const [clientsByName, invoicesByNumber, legsByFromIcao, legsByToIcao] = await Promise.all([
      supabase
        .from("clients")
        .select("id, name, archived_at, contact_name")
        .ilike("name", pattern)
        .order("name", { ascending: true })
        .limit(PER_TYPE_LIMIT),
      supabase
        .from("invoices")
        .select("id, client_id, invoice_number, status, issued_on, due_on")
        .ilike("invoice_number", pattern)
        .order("created_at", { ascending: false })
        .limit(PER_TYPE_LIMIT),
      supabase
        .from("trip_legs")
        .select("trip_id, from_icao, to_icao, leg_date")
        .ilike("from_icao", pattern)
        .order("leg_date", { ascending: false })
        .limit(LOOKUP_LIMIT),
      supabase
        .from("trip_legs")
        .select("trip_id, from_icao, to_icao, leg_date")
        .ilike("to_icao", pattern)
        .order("leg_date", { ascending: false })
        .limit(LOOKUP_LIMIT),
    ]);

    if (
      clientsByName.error ||
      invoicesByNumber.error ||
      legsByFromIcao.error ||
      legsByToIcao.error
    ) {
      return NextResponse.json<CommandSearchResponse>({ error: true, ...EMPTY_RESPONSE });
    }

    const clients = (clientsByName.data ?? []) as ClientRow[];
    const clientIds = clients.map((c) => c.id);
    // A leg can repeat a trip (multiple legs, one trip, or a match on both
    // ends of the same leg); the trip is the record a pilot navigates to,
    // so this collapses to unique trip ids before the second pass, capped
    // to what the palette will ever show.
    const legTripIds = Array.from(
      new Set([
        ...((legsByFromIcao.data ?? []) as LegRow[]).map((l) => l.trip_id),
        ...((legsByToIcao.data ?? []) as LegRow[]).map((l) => l.trip_id),
      ])
    ).slice(0, PER_TYPE_LIMIT);

    // PASS 2 — records reached only VIA the client-name match (an invoice
    // or trip for a matched client, even if its own number/ICAO says
    // nothing about the query) plus the trips behind the matched legs.
    // Skipped when there is nothing to look up, same reasoning as
    // trips/page.tsx's `if (trips.length > 0)` guard on its own RPC call.
    const [invoicesByClient, tripsByClient, tripsByIcao] = await Promise.all([
      clientIds.length > 0
        ? supabase
            .from("invoices")
            .select("id, client_id, invoice_number, status, issued_on, due_on")
            .in("client_id", clientIds)
            .order("created_at", { ascending: false })
            .limit(PER_TYPE_LIMIT)
        : Promise.resolve({ data: [] as InvoiceRow[], error: null }),
      clientIds.length > 0
        ? supabase
            .from("trips")
            .select("id, client_id, status, starts_on, aircraft_ident")
            .in("client_id", clientIds)
            .order("starts_on", { ascending: false })
            .limit(PER_TYPE_LIMIT)
        : Promise.resolve({ data: [] as TripRow[], error: null }),
      legTripIds.length > 0
        ? supabase
            .from("trips")
            .select("id, client_id, status, starts_on, aircraft_ident")
            .in("id", legTripIds)
            .order("starts_on", { ascending: false })
            .limit(PER_TYPE_LIMIT)
        : Promise.resolve({ data: [] as TripRow[], error: null }),
    ]);

    if (invoicesByClient.error || tripsByClient.error || tripsByIcao.error) {
      return NextResponse.json<CommandSearchResponse>({ error: true, ...EMPTY_RESPONSE });
    }

    const invoices = dedupeById([
      ...((invoicesByNumber.data ?? []) as InvoiceRow[]),
      ...((invoicesByClient.data ?? []) as InvoiceRow[]),
    ]).slice(0, PER_TYPE_LIMIT);

    const trips = dedupeById([
      ...((tripsByClient.data ?? []) as TripRow[]),
      ...((tripsByIcao.data ?? []) as TripRow[]),
    ]).slice(0, PER_TYPE_LIMIT);

    // PASS 3 — the two lookups every label above needs and cannot supply
    // itself: the client name behind an invoice/trip that was found by
    // something OTHER than its client (invoice number, leg ICAO), and one
    // representative leg (earliest by date) per trip for the route label.
    const namedClientIds = new Set([
      ...invoices.map((i) => i.client_id),
      ...trips.map((t) => t.client_id).filter((id): id is string => id !== null),
    ]);
    const tripIds = trips.map((t) => t.id);

    const [clientNamesResult, tripLegsResult] = await Promise.all([
      namedClientIds.size > 0
        ? supabase.from("clients").select("id, name").in("id", Array.from(namedClientIds))
        : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
      tripIds.length > 0
        ? supabase
            .from("trip_legs")
            .select("trip_id, from_icao, to_icao, leg_date")
            .in("trip_id", tripIds)
            .order("leg_date", { ascending: true })
        : Promise.resolve({ data: [] as LegRow[], error: null }),
    ]);

    if (clientNamesResult.error || tripLegsResult.error) {
      return NextResponse.json<CommandSearchResponse>({ error: true, ...EMPTY_RESPONSE });
    }

    const clientNameById = new Map(
      ((clientNamesResult.data ?? []) as { id: string; name: string }[]).map((c) => [
        c.id,
        c.name,
      ])
    );
    // First leg per trip, in leg_date order — trip_legs has no natural
    // "primary leg" column, so this takes the earliest, which is what a
    // pilot means by "the route" for a multi-leg trip's headline.
    const firstLegByTrip = new Map<string, { from_icao: string | null; to_icao: string | null }>();
    for (const leg of (tripLegsResult.data ?? []) as LegRow[]) {
      if (!firstLegByTrip.has(leg.trip_id)) {
        firstLegByTrip.set(leg.trip_id, { from_icao: leg.from_icao, to_icao: leg.to_icao });
      }
    }

    const clientResults: CommandSearchResult[] = clients.map((c) => ({
      href: `/clients/${c.id}`,
      label: c.name,
      sublabel: c.archived_at
        ? "Archived client"
        : c.contact_name
          ? c.contact_name
          : "Client",
    }));

    const invoiceResults: CommandSearchResult[] = invoices.map((inv) => ({
      href: `/invoices/${inv.id}`,
      label: inv.invoice_number ?? "Draft invoice",
      sublabel: [
        clientNameById.get(inv.client_id) ?? "Unknown client",
        INVOICE_STATUS_LABEL[inv.status] ?? inv.status,
        inv.due_on ? `due ${formatDate(inv.due_on)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));

    const tripResults: CommandSearchResult[] = trips.map((trip) => {
      const leg = firstLegByTrip.get(trip.id);
      const route =
        leg && (leg.from_icao || leg.to_icao)
          ? `${leg.from_icao ?? "?"} → ${leg.to_icao ?? "?"}`
          : trip.aircraft_ident ?? "Trip";
      return {
        href: `/trips/${trip.id}`,
        label: route,
        sublabel: [
          trip.client_id ? clientNameById.get(trip.client_id) ?? "Unknown client" : "No client",
          TRIP_STATUS_LABEL[trip.status] ?? trip.status,
          formatDate(trip.starts_on),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    });

    return NextResponse.json<CommandSearchResponse>({
      error: false,
      clients: clientResults,
      invoices: invoiceResults,
      trips: tripResults,
    });
  } catch {
    // Anything unexpected (a network blip to the Data API, a malformed
    // response) lands here rather than becoming an unhandled rejection
    // that Next renders as an HTML 500 — see the file header.
    return NextResponse.json<CommandSearchResponse>({ error: true, ...EMPTY_RESPONSE });
  }
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
