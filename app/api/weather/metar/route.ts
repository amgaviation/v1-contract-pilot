import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchMetar, type MetarResult } from "@/lib/weather/metar";

/**
 * MANUAL METAR RE-LOOKUP — used only by the weather card's client-side
 * "look up another station" input. The initial page render calls
 * fetchMetar directly (no HTTP hop); this route exists solely so the
 * browser has something to call afterward.
 *
 * AUTH. Cookie-bound createClient() + auth.getUser(), same pattern as
 * app/api/command-search/route.ts: JSON-only errors, no HTML error pages,
 * refused with 401 before any fetch runs for a signed-out request. A
 * METAR itself is public data keyed only by ICAO — no account_id scoping
 * is needed or meaningful here — but the endpoint must still not be an
 * open unauthenticated proxy.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, kind: "refused", error: "Sign in to look up weather." } satisfies MetarResult,
      { status: 401 }
    );
  }

  const icao = (request.nextUrl.searchParams.get("icao") ?? "").trim();
  const result = await fetchMetar(icao);
  return NextResponse.json<MetarResult>(result);
}
