import NextLink from "next/link";
import { LCard, LPill, LStat, LTable, LTd, LTh } from "@/components/ledger";
import { formatDate } from "@/lib/format";
import type { LogbookRole, LogbookSource, SimulatorDeviceType } from "./db";

/**
 * THE LOGBOOK SCREEN'S THREE TABLES AND ITS CARD ROW, as props-driven
 * components. Extracted from ./page.tsx, which composes all three and
 * remains the only thing that queries for them: the gating (a failed read
 * is not an empty logbook), the empty states, the pagination and the
 * filter caption all stay there, beside the reads that decide them.
 *
 * WHY THEY MOVED. app/(dev)/marketing-shots renders these same components
 * with fabricated rows so the landing page's logbook screenshot is the
 * REAL screen rather than a drawing of it — see that harness's header. A
 * screenshot taken from a look-alike drifts the first time a column moves;
 * one taken from this file cannot, because ./page.tsx renders this file
 * too. Nothing here reads a session, a tenant, or the database.
 *
 * Every prop type below is a STRUCTURAL SUBSET of the row types in ./db.ts
 * (LogbookEntryRow, TimeByTypeRow, LogbookFilteredTotalsRow), naming only
 * the columns these cells actually render — so the real page passes its
 * query results straight through with no mapping, and the harness does not
 * have to fabricate forty columns to draw nine.
 */

/* ── The career/filtered totals row ─────────────────────────────────── */

export type LogbookTotalsView = {
  /** AIRCRAFT time. Simulator hours are their own figure, never added in. */
  total: number;
  pic: number;
  night: number;
  instrument: number;
  simulator: number;
  landings: number;
};

/**
 * Six figures, two-up on a phone and six-up from md. Simulator keeps its
 * own card for the reason ./page.tsx's own comment gives: a pilot-history
 * form asks for it separately from time in the aircraft.
 */
export function LogbookTotalsCards({ totals }: { totals: LogbookTotalsView }) {
  const stats = [
    { label: "Total time", value: totals.total, decimals: 1 },
    { label: "PIC", value: totals.pic, decimals: 1 },
    { label: "Night", value: totals.night, decimals: 1 },
    { label: "Instrument", value: totals.instrument, decimals: 1 },
    { label: "Simulator", value: totals.simulator, decimals: 1 },
    { label: "Landings", value: totals.landings, decimals: 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      {stats.map((stat) => (
        <LCard key={stat.label} className="items-center text-center">
          <LStat
            label={stat.label}
            figure={stat.decimals === 0 ? stat.value : stat.value.toFixed(1)}
          />
        </LCard>
      ))}
    </div>
  );
}

/* ── Hours by type ──────────────────────────────────────────────────── */

export type HoursByTypeView = {
  label: string;
  /** AIRCRAFT time. See LogbookTotalsView.total. */
  total: number;
  pic: number;
  sic: number;
  night: number;
  simulator: number;
  /** False renders the "No aircraft on file" pill — see the cell below. */
  registered: boolean;
};

export function HoursByTypeTable({ rows }: { rows: readonly HoursByTypeView[] }) {
  return (
    <LTable>
      <caption>
        <span className="sr-only">Hours by type</span>
      </caption>
      <thead>
        <tr>
          <LTh>Type</LTh>
          <LTh numeric>Total</LTh>
          <LTh numeric>PIC</LTh>
          <LTh numeric>SIC</LTh>
          <LTh numeric>Night</LTh>
          <LTh numeric>Sim</LTh>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th
              scope="row"
              className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
            >
              <div className="flex items-center gap-2">
                <span>{row.label}</span>
                {/* Says WHY a row reads the way it does: these hours are
                    grouped by what the pilot typed on each entry, not by a
                    registered airframe, so the same aeroplane spelled two
                    ways is still two rows here. */}
                {row.registered ? null : (
                  <LPill tone="neutral">No aircraft on file</LPill>
                )}
              </div>
            </th>
            <LTd numeric>
              <span className="font-medium">{row.total.toFixed(1)}</span>
            </LTd>
            <LTd numeric>
              <span className="text-ink-2">{row.pic.toFixed(1)}</span>
            </LTd>
            <LTd numeric>
              <span className="text-ink-2">{row.sic.toFixed(1)}</span>
            </LTd>
            <LTd numeric>
              <span className="text-ink-2">{row.night.toFixed(1)}</span>
            </LTd>
            {/* Its own column, never folded into Total. An underwriter's
                pilot-history form asks for simulator time separately,
                because it is not time in the aircraft. */}
            <LTd numeric>
              <span className="text-ink-2">{row.simulator.toFixed(1)}</span>
            </LTd>
          </tr>
        ))}
      </tbody>
    </LTable>
  );
}

/* ── The entries table ──────────────────────────────────────────────── */

// Ledger's LPill vocabulary (neutral/accent/good/warn/crit) replaces
// Radix Badge's gray/blue/amber/green/red one-for-one — see
// invoices/page.tsx's own statusToPillTone for the same dictionary.
type SourceBadge = { tone: "neutral" | "accent" | "good" | "warn" | "crit"; label: string };

const SOURCE_FALLBACK: SourceBadge = { tone: "neutral", label: "Manual" };
const SOURCE_BADGE: Record<LogbookSource, SourceBadge> = {
  manual: SOURCE_FALLBACK,
  trip: { tone: "accent", label: "From trip" },
  import: { tone: "neutral", label: "Imported" },
  foreflight_sync: { tone: "neutral", label: "ForeFlight sync" },
};

/**
 * The columns the entries table renders. A structural subset of
 * ./db.ts's LogbookEntryRow, so `LogbookEntryRow[]` is assignable here
 * with no mapping step in ./page.tsx.
 */
export type LogbookEntryCells = {
  id: string;
  entry_date: string;
  from_icao: string | null;
  to_icao: string | null;
  aircraft_ident: string | null;
  role: LogbookRole | null;
  simulator_device_type: SimulatorDeviceType | null;
  total_time: number;
  night_time: number | null;
  instrument_actual_time: number | null;
  instrument_simulated_time: number | null;
  day_landings_full_stop: number;
  day_landings_touch_go: number;
  night_landings_full_stop: number;
  night_landings_touch_go: number;
  source: LogbookSource;
};

// logbookFrom() returns `any` (see its own comment), so nothing type-checks
// these numeric(4,1) columns before they reach here — if one ever arrives
// as a string, `+` concatenates instead of adding and `.toFixed` throws a
// 500. Number() coerces the same way trips/invoices/page.tsx already does
// for their own numerics, so a string doesn't silently become NaN-shaped
// arithmetic three renders downstream.
function landings(entry: LogbookEntryCells): number {
  return (
    Number(entry.day_landings_full_stop) +
    Number(entry.day_landings_touch_go) +
    Number(entry.night_landings_full_stop) +
    Number(entry.night_landings_touch_go)
  );
}

export function LogbookEntriesTable({
  entries,
}: {
  entries: readonly LogbookEntryCells[];
}) {
  return (
    <LTable>
      <caption>
        <span className="sr-only">Logbook entries</span>
      </caption>
      <thead>
        <tr>
          <LTh>Date</LTh>
          <LTh>Route</LTh>
          <LTh>Aircraft</LTh>
          <LTh>Role</LTh>
          <LTh numeric>Total</LTh>
          <LTh numeric>Night</LTh>
          <LTh numeric>Instrument</LTh>
          <LTh numeric>Landings</LTh>
          <LTh numeric>Source</LTh>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const source = SOURCE_BADGE[entry.source] ?? SOURCE_FALLBACK;
          return (
            <tr key={entry.id}>
              <th
                scope="row"
                className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
              >
                <NextLink
                  href={`/logbook/${entry.id}`}
                  className="text-accent hover:underline"
                >
                  {formatDate(entry.entry_date)}
                </NextLink>
              </th>
              <LTd>
                <span className="text-ink-2">
                  {entry.from_icao ?? "—"} → {entry.to_icao ?? "—"}
                </span>
              </LTd>
              <LTd>
                <span className="text-ink-2">{entry.aircraft_ident ?? "—"}</span>
              </LTd>
              <LTd>
                <span className="text-ink-2">
                  {/* A wholly-simulator entry carries no crew role
                      (20260810020000). Showing the device says WHY the role
                      is absent, which is more use to a pilot scanning the
                      column than a bare dash. */}
                  {entry.role ??
                    (entry.simulator_device_type
                      ? entry.simulator_device_type.toUpperCase()
                      : "—")}
                </span>
              </LTd>
              <LTd numeric>
                <span className="font-medium">{Number(entry.total_time).toFixed(1)}</span>
              </LTd>
              <LTd numeric>
                <span className="text-ink-2">{Number(entry.night_time ?? 0).toFixed(1)}</span>
              </LTd>
              <LTd numeric>
                <span className="text-ink-2">
                  {(
                    Number(entry.instrument_actual_time ?? 0) +
                    Number(entry.instrument_simulated_time ?? 0)
                  ).toFixed(1)}
                </span>
              </LTd>
              <LTd numeric>
                <span className="text-ink-2">{landings(entry)}</span>
              </LTd>
              <LTd numeric>
                <LPill tone={source.tone}>{source.label}</LPill>
              </LTd>
            </tr>
          );
        })}
      </tbody>
    </LTable>
  );
}
