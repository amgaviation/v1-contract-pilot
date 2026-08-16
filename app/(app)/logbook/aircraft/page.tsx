import NextLink from "next/link";
import { LAlert, LCard, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { logbookFrom } from "../db";
import type {
  AircraftRow,
  TimeByTailRow,
  TimeByTypeRow,
  UnregisteredIdentRow,
} from "./db";
import FleetPanel, { type FleetAircraft, type Suggestion } from "./fleet-panel";

export const metadata = { title: "Your aircraft" };

/**
 * The pilot's fleet.
 *
 * Lives under /logbook rather than in the nav rail on purpose: an airframe
 * is something a pilot thinks about while looking at their hours, and the
 * rail's eight sections are fixed by docs/PLAN.md. The link sits beside
 * "Trip drafts" and "Import CSV" on the logbook page.
 *
 * Nothing here writes to pilot.logbook_entries. The registry annotates
 * history by matching a normalised tail key at read time; the entries
 * themselves are a legal record under 61.51 and stay exactly as the pilot
 * wrote them. See the migration header.
 */

/** A pilot who flies 40 airframes has an unusual career, not a paging problem. */
const FLEET_LIMIT = 500;
/** Enough suggestions to build a real fleet from; more would be a wall of buttons. */
const SUGGESTION_LIMIT = 24;
/**
 * EVERY type, not a summary. The logbook page shows the top twelve and
 * links here for the rest, so this is the one place the number has to be
 * complete — a pilot-history form is not a highlights reel.
 */
const TYPE_LIMIT = 500;

export default async function AircraftPage() {
  const { account } = await requireAccount("/logbook/aircraft");
  const supabase = await createClient();
  if (!account) return null;

  // Every read below carries .eq("account_id", …) even though RLS already
  // confines it. current_account_ids() returns EVERY account a user
  // belongs to, and createAircraft writes to exactly one of them — so on
  // the day a business account has two members, reads that trusted RLS
  // alone would show a merged fleet while "Add an aircraft" quietly filed
  // into a single account. Reads match writes.
  const [
    { data: fleetData, error },
    { data: timeData, error: timeError },
    { data: suggestionData, error: suggestionError },
    { data: byTypeData, error: byTypeError },
  ] = await Promise.all([
    logbookFrom(supabase, "aircraft")
      .select("*")
      .eq("account_id", account.id)
      .order("archived_at", { ascending: true, nullsFirst: true })
      .order("tail_key", { ascending: true })
      .limit(FLEET_LIMIT),
    logbookFrom(supabase, "aircraft_time_by_tail")
      .select("*")
      .eq("account_id", account.id)
      .limit(FLEET_LIMIT),
    // One more than we show, so "and 39 more" is a fact rather than a
    // guess. A heading that says "24 tails" when there are 63 is a wrong
    // number presented as a certainty.
    logbookFrom(supabase, "aircraft_unregistered_idents")
      .select("*")
      .eq("account_id", account.id)
      .order("total_time", { ascending: false })
      .order("tail_key", { ascending: true })
      .limit(SUGGESTION_LIMIT + 1),
    logbookFrom(supabase, "logbook_time_by_type")
      .select("*")
      .eq("account_id", account.id)
      .order("total_time", { ascending: false })
      .order("type_label", { ascending: true })
      .limit(TYPE_LIMIT),
  ]);

  const rows = (fleetData ?? []) as AircraftRow[];
  const timeRows = (timeData ?? []) as TimeByTailRow[];
  const byId = new Map(timeRows.map((row) => [row.aircraft_id, row]));
  // A FAILED hours read is not zero hours. Rendering 0.0 next to an
  // airframe with three years of history reads as "the match broke" and
  // sends a pilot off editing tail numbers that were never wrong. Same
  // rule the logbook page already applies to career totals.
  const hoursUnavailable = Boolean(timeError);

  const aircraft: FleetAircraft[] = rows.map((row) => {
    const time = byId.get(row.id);
    return {
      id: row.id,
      tail_number: row.tail_number,
      type_designator: row.type_designator,
      type_rating: row.type_rating,
      make_model: row.make_model,
      gear: row.gear,
      category_class: row.category_class,
      notes: row.notes,
      archived_at: row.archived_at,
      // A failed or missing hours read is zero HOURS, not a missing
      // aircraft — the fleet list is the registry, and it renders whether
      // or not the rollup answered.
      entryCount: Number(time?.entry_count ?? 0),
      totalTime: Number(time?.total_time ?? 0),
      picTime: Number(time?.pic_time ?? 0),
      simulatorTime: Number(time?.simulator_time ?? 0),
      lastFlownOn: time?.last_flown_on ?? null,
    };
  });

  const suggestionRows = (suggestionData ?? []) as UnregisteredIdentRow[];
  const moreSuggestions = suggestionRows.length > SUGGESTION_LIMIT;
  const suggestions: Suggestion[] = suggestionRows.slice(0, SUGGESTION_LIMIT).map(
    (row) => ({
      tailKey: row.tail_key,
      aircraftIdent: row.aircraft_ident,
      aircraftType: row.aircraft_type,
      entryCount: Number(row.entry_count),
      totalTime: Number(row.total_time),
      lastFlownOn: row.last_flown_on,
    })
  );

  const byType = ((byTypeData ?? []) as TimeByTypeRow[]).map((row) => ({
    label: row.type_label,
    total: Number(row.total_time),
    pic: Number(row.pic_time),
    sic: Number(row.sic_time),
    night: Number(row.night_time),
    simulator: Number(row.simulator_time),
    entries: Number(row.entry_count),
    registered: row.has_registered_aircraft === true,
  }));

  return (
    <LPageShell
      title="Your aircraft"
      subtitle="These are the airframes behind your hours, so your logbook can answer “how much time in type?”"
      action={
        <NextLink href="/logbook" className={lButtonClass({ variant: "outline" })}>
          Back to logbook
        </NextLink>
      }
    >
      {error ? (
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>{friendlyDbError(error, "aircraft.select")}</span>
        </LAlert>
      ) : (
        <div className="flex flex-col gap-4">
          {hoursUnavailable ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                Your hours couldn&rsquo;t be loaded just now, so the Hours and Last
                flown columns are blank rather than wrong. Your fleet and your
                logbook are both fine.
              </span>
            </LAlert>
          ) : null}
          {suggestionError ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                We couldn&rsquo;t check which tails you&rsquo;ve flown but not added
                yet, so this page isn&rsquo;t offering any. You can still add one by
                hand.
              </span>
            </LAlert>
          ) : null}
          <FleetPanel
            aircraft={aircraft}
            suggestions={suggestions}
            moreSuggestions={moreSuggestions}
            hoursUnavailable={hoursUnavailable}
          />

          <LCard>
            <div className="flex flex-col gap-3">
              <h2 className="text-h3 font-semibold">Every type you have time in</h2>

              {byTypeError ? (
                <LAlert tone="warn" className="flex items-start gap-2">
                  <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                  <span>
                    This couldn&rsquo;t be loaded just now. Nothing is wrong with
                    your entries.
                  </span>
                </LAlert>
              ) : byType.length === 0 ? (
                <p className="text-body-s text-ink-2">
                  Nothing to group yet. Log a flight, or import your logbook.
                </p>
              ) : (
                <LTable>
                  <caption>
                    <span className="sr-only">Every type you have time in</span>
                  </caption>
                  <thead>
                    <tr>
                      <LTh>Type</LTh>
                      <LTh numeric>Total</LTh>
                      <LTh numeric>PIC</LTh>
                      <LTh numeric>SIC</LTh>
                      <LTh numeric>Night</LTh>
                      <LTh numeric>Sim</LTh>
                      <LTh numeric>Entries</LTh>
                    </tr>
                  </thead>
                  <tbody>
                    {byType.map((row) => (
                      <tr key={row.label}>
                        <th
                          scope="row"
                          className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                        >
                          <div className="flex items-center gap-2">
                            <span>{row.label}</span>
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
                        <LTd numeric>
                          <span className="text-ink-2">{row.simulator.toFixed(1)}</span>
                        </LTd>
                        <LTd numeric>
                          <span className="text-ink-2">{row.entries}</span>
                        </LTd>
                      </tr>
                    ))}
                  </tbody>
                </LTable>
              )}
            </div>
          </LCard>
        </div>
      )}
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shape as invoices/page.tsx's own WarningIcon. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
