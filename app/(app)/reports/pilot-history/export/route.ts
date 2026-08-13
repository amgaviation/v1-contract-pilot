import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { csvRow } from "@/lib/csv";
import { BRAND } from "@/lib/brand";
import { logbookFrom, type LogbookEntryRow } from "../../../logbook/db";
import {
  compiledFromFooter,
  flagIsAnswerable,
  futureDatedNote,
  todayIso,
  totalInstrument,
  totalLandings,
  totalTakeoffs,
  unattributedEntriesNote,
  type BreakdownRow,
  type FlaggedHours,
  type PilotHistoryFigures,
} from "../report-lib";
import {
  airmanScopeFilter,
  isAirmanId,
  loadPilotHistoryReport,
} from "../queries";

// The pilot's own compiled record, never a cached artifact.
export const dynamic = "force-dynamic";

/**
 * TWO SECTIONS, TWO DIFFERENT SHAPES, and the difference is the whole
 * design of this file.
 *
 *   ?section=summary   the report itself — totals, the breakdowns, the
 *                      recorded dates. BOUNDED (a few hundred rows even
 *                      for a career), so it follows the year-end export's
 *                      shape: fetch everything, resolve every error before
 *                      the first byte, a real 500 and never a partial 200.
 *
 *   ?section=entries   the evidence behind those figures — every logbook
 *                      entry, one row each. UNBOUNDED: a career logbook
 *                      has no ceiling this schema enforces, so it follows
 *                      app/(app)/logbook/export/route.ts's shape and
 *                      STREAMS, paging with .range() rather than
 *                      inheriting PostgREST's silent ~1000-row truncation.
 *
 * The two guarantees are mutually exclusive once bytes are on the wire —
 * the logbook export's header works that through in full — so each section
 * takes the one that fits its own size. What both promise is the same and
 * is the only promise that matters here: no error ever produces a file
 * that LOOKS complete and is silently short. The summary refuses with a
 * status code; the stream aborts the connection mid-file rather than
 * closing it cleanly.
 *
 * THE LINE holds in a spreadsheet exactly as it does on the screen: pure
 * arithmetic over what the pilot logged and recorded, no conclusion drawn
 * from it, and no wording about currency or qualification anywhere in the
 * file. See report-lib.ts's header. The footer row is the same sentence
 * the page and the PDF end with, from the same function — a CSV travels
 * further than either of them and needs its provenance inside it.
 */
const SECTIONS = ["summary", "entries"] as const;
type Section = (typeof SECTIONS)[number];

/** Well under PostgREST's cap, paged — see the logbook export's note. */
const ENTRIES_PAGE_SIZE = 500;

const ENTRIES_HEADER = [
  "Date",
  "Aircraft Ident",
  "Aircraft Type",
  "From",
  "To",
  "Role",
  "Total Time",
  "Simulator Time",
  "PIC Time",
  "SIC Time",
  "Cross Country Time",
  "Night Time",
  "Instrument Actual Time",
  "Instrument Simulated Time",
  "Day Takeoffs",
  "Night Takeoffs",
  "Day Landings Full Stop",
  "Day Landings Touch and Go",
  "Night Landings Full Stop",
  "Night Landings Touch and Go",
] as const;

function entryToValues(e: LogbookEntryRow): (string | number | null | undefined)[] {
  return [
    e.entry_date,
    e.aircraft_ident,
    e.aircraft_type,
    e.from_icao,
    e.to_icao,
    e.role,
    e.total_time,
    e.simulator_time,
    e.pic_time,
    e.sic_time,
    e.cross_country_time,
    e.night_time,
    e.instrument_actual_time,
    e.instrument_simulated_time,
    e.day_takeoffs,
    e.night_takeoffs,
    e.day_landings_full_stop,
    e.day_landings_touch_go,
    e.night_landings_full_stop,
    e.night_landings_touch_go,
  ];
}

/**
 * A CSV whose header and rows disagree does not fail — it SHIFTS, silently,
 * so every column after the mismatch carries its neighbour's value. The
 * logbook export records what that cost the first time and closed it with
 * exactly this check; this file is a second hand-maintained pair of lists
 * and gets the same guard, at module load, so a mismatch is a startup error
 * rather than a corrupted download on an underwriter's desk.
 */
{
  const probeLength = entryToValues({} as LogbookEntryRow).length;
  if (probeLength !== ENTRIES_HEADER.length) {
    throw new Error(
      `pilot-history export is broken: ENTRIES_HEADER has ${ENTRIES_HEADER.length} columns but each row emits ${probeLength}. ` +
        "A CSV with mismatched header and row lengths shifts every later column instead of failing."
    );
  }
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pilot"
  );
}

function hours(value: number): string {
  return value.toFixed(1);
}

/** A three-state figure as a CELL. "Not recorded" rather than 0.0, for the
 *  same reason the screen withholds it: a confident zero in a spreadsheet
 *  column headed "Turbine time" is an answer, and the wrong one. */
function flagCell(figure: FlaggedHours): string {
  return flagIsAnswerable(figure) ? hours(figure.hours) : "Not recorded";
}

function breakdownRows(
  title: string,
  heading: string,
  rows: BreakdownRow[],
  withheld: string | null
): string[] {
  const out: string[] = [csvRow([]), csvRow([title])];
  if (withheld !== null) {
    out.push(csvRow([withheld]));
    return out;
  }
  // The unmatched count is its OWN column rather than a note folded into
  // the label: a row can hold hours from an airframe on file and hours that
  // matched none, and in a spreadsheet that fact has to be sortable rather
  // than buried in a string.
  out.push(
    csvRow([
      heading,
      "Entries",
      "Entries not matched to an aircraft on file",
      "Total",
      "PIC",
      "SIC",
      "Night",
      "Simulator",
      "Last flown",
    ])
  );
  for (const row of rows) {
    out.push(
      csvRow([
        row.sublabel ? `${row.label} (${row.sublabel})` : row.label,
        row.entryCount,
        row.unmatchedEntryCount,
        hours(row.total),
        hours(row.pic),
        hours(row.sic),
        hours(row.night),
        hours(row.simulator),
        row.lastFlownOn ?? "",
      ])
    );
  }
  return out;
}

function summaryRows(
  allTime: PilotHistoryFigures,
  recent: PilotHistoryFigures
): string[] {
  const a = allTime.hours;
  const r = recent.hours;
  const rows: string[] = [];

  rows.push(csvRow(["Flight time"]));
  rows.push(csvRow(["", "All time", `Last 12 months (${recent.window.label})`]));
  const pairs: [string, string, string][] = [
    ["Total time (aircraft)", hours(a.total), hours(r.total)],
    ["PIC", hours(a.pic), hours(r.pic)],
    ["SIC", hours(a.sic), hours(r.sic)],
    ["Solo", hours(a.solo), hours(r.solo)],
    ["Dual received", hours(a.dualReceived), hours(r.dualReceived)],
    ["Instructor given", hours(a.instructorGiven), hours(r.instructorGiven)],
    ["Cross country", hours(a.crossCountry), hours(r.crossCountry)],
    ["Night", hours(a.night), hours(r.night)],
    ["Instrument - actual", hours(a.instrumentActual), hours(r.instrumentActual)],
    ["Instrument - simulated", hours(a.instrumentSimulated), hours(r.instrumentSimulated)],
    ["Instrument - total", hours(totalInstrument(a)), hours(totalInstrument(r))],
    // Its own row, and captioned in the row label itself: this file is
    // opened without the page around it, and a simulator figure that could
    // be read as aircraft time is the single most consequential
    // misreading of a pilot-history form.
    ["Simulator (not aircraft time)", hours(a.simulator), hours(r.simulator)],
    ["Takeoffs", String(totalTakeoffs(a)), String(totalTakeoffs(r))],
    ["Landings", String(totalLandings(a)), String(totalLandings(r))],
    [
      "Night landings",
      String(a.nightLandingsFullStop + a.nightLandingsTouchGo),
      String(r.nightLandingsFullStop + r.nightLandingsTouchGo),
    ],
    ["Logbook entries", String(a.entryCount), String(r.entryCount)],
  ];
  for (const [label, allValue, recentValue] of pairs) {
    rows.push(csvRow([label, allValue, recentValue]));
  }

  rows.push(csvRow([]));
  rows.push(csvRow(["Turbine and retractable gear"]));
  // EACH SHORTFALL NAMES ITS WINDOW. One unlabelled "not counted either
  // way" column beside two figures qualified nothing in particular — a
  // reader copying the last-12-months figure was reading the all-time
  // shortfall next to it.
  rows.push(
    csvRow([
      "",
      "All time",
      "Last 12 months",
      "Hours not counted either way (all time)",
      "Hours not counted either way (last 12 months)",
    ])
  );
  rows.push(
    csvRow([
      "Turbine time",
      flagCell(allTime.turbine),
      flagCell(recent.turbine),
      flagIsAnswerable(allTime.turbine) ? hours(allTime.turbine.unrecordedHours) : "",
      flagIsAnswerable(allTime.turbine) ? hours(recent.turbine.unrecordedHours) : "",
    ])
  );
  rows.push(
    csvRow([
      "Retractable-gear time",
      flagCell(allTime.retractable),
      flagCell(recent.retractable),
      flagIsAnswerable(allTime.retractable)
        ? hours(allTime.retractable.unrecordedHours)
        : "",
      flagIsAnswerable(allTime.retractable)
        ? hours(recent.retractable.unrecordedHours)
        : "",
    ])
  );

  rows.push(
    ...breakdownRows(
      "By category and class",
      "Category and class",
      allTime.byCategoryClass,
      allTime.categoryClassUnrecorded
        ? "Not recorded - no aircraft on this account carries a category and class."
        : null
    )
  );
  rows.push(...breakdownRows("By type", "Type", allTime.byType, null));
  rows.push(...breakdownRows("By aircraft", "Aircraft", allTime.byTail, null));

  return rows;
}

export async function GET(request: NextRequest) {
  const { account, user } = await requireAccount("/reports/pilot-history");

  const url = new URL(request.url);
  const sectionParam = (url.searchParams.get("section") ?? "summary") as Section;
  if (!SECTIONS.includes(sectionParam)) {
    return NextResponse.json(
      { error: `?section= must be one of: ${SECTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  const today = todayIso();
  const supabase = await createClient();
  const nameSlug = slugify(account.legal_name ?? account.id);

  // -------------------------------------------------------------------
  // The unbounded section. Streams; see the header.
  // -------------------------------------------------------------------
  if (sectionParam === "entries") {
    // THE EVIDENCE IS SCOPED EXACTLY AS THE FIGURES ARE. This section is
    // the entry-by-entry backing for the summary above, so it goes through
    // the same airman filter — a spreadsheet of entries that does not add
    // up to the totals it was downloaded to support is worse than no
    // spreadsheet. Refusing on a malformed id matches the loader's own
    // branch; widening to the whole account is exactly what must not
    // happen silently.
    if (!isAirmanId(user.id)) {
      console.error("[pilot-history export] session user id is not a uuid");
      return NextResponse.json(
        { error: "Couldn't establish which airman this export is for." },
        { status: 500 }
      );
    }
    // The first page is fetched BEFORE the streaming Response is
    // constructed and before any bytes are sent, so the common failure
    // modes (a bad query, an RLS reject, a dead connection) still produce
    // a real status and zero bytes.
    const firstPage = await logbookFrom(supabase, "logbook_entries")
      .select("*")
      .eq("account_id", account.id)
      .or(airmanScopeFilter(user.id))
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(0, ENTRIES_PAGE_SIZE - 1);

    if (firstPage.error) {
      console.error("[pilot-history export] first page fetch failed", firstPage.error);
      return NextResponse.json(
        { error: "Couldn't load your logbook entries for export." },
        { status: 500 }
      );
    }

    const encoder = new TextEncoder();
    let offset = 0;
    let firstBatch = (firstPage.data ?? []) as LogbookEntryRow[];
    let done = firstBatch.length < ENTRIES_PAGE_SIZE;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(csvRow([...ENTRIES_HEADER])));
        for (const entry of firstBatch) {
          controller.enqueue(encoder.encode(csvRow(entryToValues(entry))));
        }
        offset += firstBatch.length;
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
          .or(airmanScopeFilter(user.id))
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + ENTRIES_PAGE_SIZE - 1);

        if (error) {
          console.error("[pilot-history export] page fetch failed mid-stream", error);
          // Tears the connection down rather than completing it: the
          // reader gets a failed download, never bytes that look like a
          // clean, complete file.
          controller.error(new Error("pilot-history entries export failed mid-stream"));
          return;
        }

        const batch = (data ?? []) as LogbookEntryRow[];
        for (const entry of batch) {
          controller.enqueue(encoder.encode(csvRow(entryToValues(entry))));
        }
        offset += batch.length;
        if (batch.length < ENTRIES_PAGE_SIZE) {
          done = true;
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pilot-history-entries-${nameSlug}-${today}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // -------------------------------------------------------------------
  // The bounded section. Everything resolved before the first byte.
  // -------------------------------------------------------------------
  const [report, kindLabels] = await Promise.all([
    loadPilotHistoryReport(supabase, account.id, user.id, today),
    loadOptionLabels("document_kind"),
  ]);

  if (report.error || !report.data) {
    console.error("[pilot-history export] report load failed", report.error);
    return NextResponse.json(
      { error: "Couldn't compile your pilot history for export." },
      { status: 500 }
    );
  }
  if (!report.data.ok) {
    return NextResponse.json(
      {
        error:
          "There are no logbook entries to compile yet, so there is no history to export.",
      },
      { status: 409 }
    );
  }

  const data = report.data;
  const rows: string[] = [];

  rows.push(csvRow(["Pilot history"]));
  // "Account", not the airman's name: accounts.legal_name is the business
  // identity, and a limited company cannot hold a pilot certificate. Same
  // correction as the PDF letterhead — see its note.
  rows.push(csvRow(["Account", account.legal_name]));
  rows.push(csvRow(["Compiled", data.compiledOn]));
  rows.push(csvRow(["Logbook covers", data.earliestEntryDate, "to", data.latestEntryDate]));
  // The caveats that qualify every figure below, in the file that travels
  // furthest of the three — same sentences as the screen and the PDF.
  const futureNote = futureDatedNote(data.futureDatedEntryCount);
  if (futureNote) rows.push(csvRow(["Not counted", futureNote]));
  const unattributedNote = unattributedEntriesNote(data.unattributedEntryCount);
  if (unattributedNote) rows.push(csvRow(["Attribution", unattributedNote]));
  // The framing sentence, INSIDE the file. This spreadsheet is emailed on
  // without the page it came from, and the person opening it is the one
  // deciding something about the pilot.
  rows.push(
    csvRow([
      "Every figure below is a sum of hours recorded in this airman's own logbook and a restatement of dates the airman entered. Nothing here is an assessment against any minimum and nothing here states what the airman may fly.",
    ])
  );
  rows.push(csvRow([]));

  rows.push(...summaryRows(data.allTime, data.lastTwelveMonths));

  rows.push(csvRow([]));
  rows.push(csvRow(["Recorded dates (as entered by the airman; nothing derived)"]));
  rows.push(
    csvRow(["Document", "Kind", "Completed", "Issued", "Expires (as entered)", "Airman"])
  );
  for (const date of data.recordedDates) {
    rows.push(
      csvRow([
        date.label,
        kindLabels[date.kind] ?? date.kind,
        date.completedOn ?? "",
        date.issuedOn ?? "",
        date.expiresOn ?? "",
        date.attribution === "you" ? "This airman" : "No airman recorded",
      ])
    );
  }

  rows.push(csvRow([]));
  rows.push(csvRow([compiledFromFooter(BRAND.name)]));

  return new NextResponse(rows.join(""), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pilot-history-${nameSlug}-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
