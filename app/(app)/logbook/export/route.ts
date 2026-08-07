import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { logbookFrom, type LogbookEntryRow } from "../db";

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
  "Day Landings Full Stop",
  "Day Landings Touch and Go",
  "Night Takeoffs",
  "Night Landings Full Stop",
  "Night Landings Touch and Go",
  "Approaches Count",
  "Approach Type",
  "Holds",
  "Remarks",
  "Source",
] as const;

/**
 * RFC 4180 field escaping. A field is quoted, with any embedded `"`
 * doubled, whenever it contains a comma, a quote, or a newline (CR or LF)
 * — the three characters that would otherwise corrupt the column
 * boundaries of every field after it. Untouched otherwise, so a plain
 * "KTEB" or "1.4" round-trips byte-identical without needless quoting.
 *
 * Also guards against CSV/formula injection: a `remarks` field is
 * pilot-authored free text, and a leading =, +, -, or @ is interpreted as
 * a formula by Excel/Sheets when the file is opened there. Prefixing such
 * a field with a leading apostrophe (inside the quotes) neutralizes that
 * without changing what a spec-compliant CSV reader hands back to a
 * program parsing the file as data rather than opening it in a
 * spreadsheet.
 */
function csvField(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}

function entryToRow(e: LogbookEntryRow): string {
  return csvRow([
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
    e.day_landings_full_stop,
    e.day_landings_touch_go,
    e.night_takeoffs,
    e.night_landings_full_stop,
    e.night_landings_touch_go,
    e.approaches_count,
    e.approach_type,
    e.holds,
    e.remarks,
    e.source,
  ]);
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
