import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { logbookFrom, type LogbookEntryRow } from "../db";
import { csvRow } from "@/lib/csv";

// This is the pilot's own copy of their legal record (14 CFR 61.51), not a
// cached artifact — always the current rows.
export const dynamic = "force-dynamic";

// PostgREST/the Supabase client default-caps a single request's rows
// (commonly ~1000) and, per the same caveat /logbook's page.tsx documents,
// TRUNCATES SILENTLY rather than erroring. A page size well under that cap,
// paged with .range(), is what lets this route promise "no row cap" instead
// of inheriting that silent truncation — a partial export of a legal record
// is worse than none, so nothing here may quietly stop at a page boundary
// without asking for the next one.
const PAGE_SIZE = 500;

const HEADER = [
  "Date",
  "Aircraft Ident",
  "Aircraft Type",
  "From",
  "To",
  "Role",
  "Total Time",
  "PIC Time",
  "SIC Time",
  "Solo Time",
  "Cross Country Time",
  "Night Time",
  "Instrument Actual Time",
  "Instrument Simulated Time",
  "Flight Instructor Time",
  "Dual Received Time",
  "Simulator Time",
  "Simulator Device Type",
  "Day Takeoffs",
  "Day Landings Full Stop",
  "Day Landings Touch and Go",
  "Night Takeoffs",
  "Night Landings Full Stop",
  "Night Landings Touch and Go",
  "Approaches Count",
  "Approach Type",
  "Approach Condition",
  "Intercepted and Tracked Course",
  "Safety Pilot",
  "Holds",
  "Sole Manipulator of Controls",
  "Night Window Asserted",
  "Remarks",
  "Source",
] as const;



/**
 * The values, in HEADER's order. Split out from entryToRow only so the two
 * can be length-checked against each other at module load — see below.
 */
function entryToValues(e: LogbookEntryRow): (string | number | null | undefined)[] {
  return [
    e.entry_date,
    e.aircraft_ident,
    e.aircraft_type,
    e.from_icao,
    e.to_icao,
    e.role,
    e.total_time,
    e.pic_time,
    e.sic_time,
    e.solo_time,
    e.cross_country_time,
    e.night_time,
    e.instrument_actual_time,
    e.instrument_simulated_time,
    e.flight_instructor_time,
    e.dual_received_time,
    e.simulator_time,
    e.simulator_device_type,
    e.day_takeoffs,
    e.day_landings_full_stop,
    e.day_landings_touch_go,
    e.night_takeoffs,
    e.night_landings_full_stop,
    e.night_landings_touch_go,
    e.approaches_count,
    e.approach_type,
    e.approach_condition,
    // The only boolean in the file. Written as Yes/No because a pilot
    // reads this CSV, and "false" in a column headed "Intercepted and
    // Tracked Course" is worse than useless next to twenty numeric fields.
    e.courses_intercepted_tracked ? "Yes" : "No",
    e.view_limiting_pilot_name,
    e.holds,
    // Both nullable booleans, unlike courses_intercepted_tracked above:
    // NULL means unrecorded and must render as blank, never as "No" — the
    // same collapse the migration's column comments (20260811040000)
    // document fighting everywhere else on this table (approach_condition,
    // sole_manipulator itself). "No" here would assert a fact ("was not
    // sole manipulator" / "flight was not in the 61.57(b)(1) night window")
    // the pilot never stated.
    e.sole_manipulator === null ? "" : e.sole_manipulator ? "Yes" : "No",
    e.night_window_asserted === null ? "" : e.night_window_asserted ? "Yes" : "No",
    e.remarks,
    e.source,
  ];
}

/**
 * A CSV whose header and rows disagree does not fail — it SHIFTS, silently,
 * so every column after the mismatch carries the neighbouring column's
 * value. In a file this route calls the pilot's legal record under 61.51,
 * that is the worst possible failure mode: it looks complete and reads
 * wrong, and the pilot has no way to spot it.
 *
 * This route already fell four columns behind the schema once —
 * day_takeoffs, approach_condition, courses_intercepted_tracked and the
 * 61.51(b)(1)(v) safety-pilot name were all missing, the last of them from
 * a migration written specifically to add it. Both lists were maintained
 * by hand and nothing compared them.
 *
 * Checked at module load, with a row of nulls, so a mismatch is a startup
 * error rather than a corrupted download. It can only fire if this file is
 * already wrong.
 */
{
  const probeLength = entryToValues({} as LogbookEntryRow).length;
  if (probeLength !== HEADER.length) {
    throw new Error(
      `logbook export is broken: HEADER has ${HEADER.length} columns but each row emits ${probeLength}. ` +
        "A CSV with mismatched header and row lengths shifts every later column instead of failing."
    );
  }
}

function entryToRow(e: LogbookEntryRow): string {
  return csvRow(entryToValues(e));
}

/** Filesystem/header-safe filename component. */
function slugify(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pilot"
  );
}

export async function GET(_request: NextRequest) {
  const { account } = await requireAccount("/logbook");
  const supabase = await createClient();

  // The first page is fetched BEFORE the streaming Response is constructed
  // and before any bytes are sent — the same "read everything that can
  // fail, then decide, then write" discipline
  // app/(app)/invoices/[id]/pdf/route.tsx uses, so the common failure
  // modes (a bad query, an RLS reject, a dead connection) still produce a
  // real error status and zero bytes, not a 200 with an empty or
  // half-written file.
  //
  // Later pages are fetched lazily as the stream is pulled, per the
  // no-row-cap requirement — buffering an entire career's logbook (which
  // has no upper bound this schema enforces) into memory before writing
  // anything would defeat the point of streaming. If a LATER page fails,
  // headers are already sent and the HTTP status can no longer change; the
  // stream is aborted with controller.error() instead, which tears down
  // the connection rather than completing it — a client sees a failed/
  // truncated download, never bytes that look like a clean, complete CSV.
  // That is the honest achievable guarantee once streaming has begun: this
  // route can promise "no error ever produces a file that LOOKS complete
  // and is silently wrong," it cannot promise "every error is a clean
  // status code," because those two guarantees are mutually exclusive
  // once the first byte is on the wire.
  const firstPage = await logbookFrom(supabase, "logbook_entries")
    .select("*")
    .eq("account_id", account.id)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, PAGE_SIZE - 1);

  if (firstPage.error) {
    console.error("[logbook export] first page fetch failed", firstPage.error);
    return NextResponse.json(
      { error: "Couldn't load your logbook for export." },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  let offset = 0;
  let firstBatch = (firstPage.data ?? []) as LogbookEntryRow[];
  let done = firstBatch.length < PAGE_SIZE;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(csvRow([...HEADER])));
      for (const entry of firstBatch) {
        controller.enqueue(encoder.encode(entryToRow(entry)));
      }
      offset += firstBatch.length;
      // Release the reference once consumed — nothing else needs it, and
      // holding it would keep the first page's rows alive for the whole
      // stream lifetime for no reason.
      firstBatch = [];
      if (done) controller.close();
    },
    async pull(controller) {
      if (done) {
        controller.close();
        return;
      }
      const { data, error } = await logbookFrom(supabase, "logbook_entries")
        .select("*")
        .eq("account_id", account.id)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error("[logbook export] page fetch failed mid-stream", error);
        controller.error(new Error("logbook export failed mid-stream"));
        return;
      }

      const batch = (data ?? []) as LogbookEntryRow[];
      for (const entry of batch) {
        controller.enqueue(encoder.encode(entryToRow(entry)));
      }
      offset += batch.length;
      if (batch.length < PAGE_SIZE) {
        done = true;
        controller.close();
      }
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `logbook-${slugify(account.legal_name ?? account.id)}-${today}.csv`;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Never cache a legal record export.
      "Cache-Control": "no-store",
    },
  });
}
