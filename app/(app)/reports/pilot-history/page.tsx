import NextLink from "next/link";
import { LAlert, LCard, LPill, LTable, LTd, LTh } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import { cn } from "@/lib/ledger/cn";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDate } from "@/lib/format";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { BRAND } from "@/lib/brand";
import {
  compiledFromFooter,
  flagIsAnswerable,
  futureDatedNote,
  mixedProvenanceNote,
  todayIso,
  totalInstrument,
  totalLandings,
  totalTakeoffs,
  unattributedEntriesNote,
  unrecordedHoursNote,
  type BreakdownRow,
  type FlaggedHours,
  type PilotHistoryFigures,
} from "./report-lib";
import { loadPilotHistoryReport } from "./queries";

export const metadata = { title: "Pilot history" };

/**
 * The pilot-history report: the numbers an underwriter, a management
 * company or a chief pilot asks a contract pilot for, compiled from the
 * pilot's own logbook and their own documents.
 *
 * THE LINE, verbatim, and it governs every string on this page: pure
 * arithmetic over what the pilot logged and recorded; NO currency or
 * legality conclusion anywhere, no regulation references in user-facing
 * copy, no "current" or "qualified" wording. See report-lib.ts's header
 * for what that rules out concretely and why the currency engine — which
 * DOES reason about eligibility — ships dark behind its own gate rather
 * than leaking into a totals page.
 */
export default async function PilotHistoryReportPage() {
  const { account, user } = await requireAccount("/reports/pilot-history");

  const today = todayIso();
  const supabase = await createClient();
  const [report, kindLabels] = await Promise.all([
    loadPilotHistoryReport(supabase, account.id, user.id, today),
    // A tenant who renamed a document kind sees their own word here, the
    // same as on /documents — a report that disagreed with the screen it
    // was compiled from would be its own bug.
    loadOptionLabels("document_kind"),
  ]);

  const data = report.data;

  return (
    <LPageShell
      title="Pilot history"
      subtitle="Your hours and your recorded dates, in the shape a history form asks for"
      action={
        data && data.ok ? (
          <>
            {/* Plain <a>, not a client-side link: these are file
                downloads, the same pattern as the logbook export and the
                invoice PDF. */}
            <a
              href="/reports/pilot-history/export?section=summary"
              download
              className="inline-flex h-9 items-center justify-center gap-2 rounded-control border border-hair-strong bg-card px-4 text-body font-medium text-ink hover:bg-sunk"
            >
              Download (CSV)
            </a>
            <a
              href="/reports/pilot-history/pdf"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-control bg-accent px-4 text-body font-medium text-accent-ink hover:opacity-92"
            >
              Download (PDF)
            </a>
          </>
        ) : null
      }
    >
      {/* LOAD-BEARING, and deliberately first — the same placement as the
          year-end and flight-time reports' framing callouts: what this
          page is and is not, above every figure on it. */}
      <LAlert tone="accent" className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 shrink-0 text-accent" />
        <div>
          <div className="font-medium text-ink">
            Arithmetic on your own records. Nothing more.
          </div>
          <div className="mt-1">
            Every figure below is a sum of the hours you logged and a
            restatement of the dates you entered. This page draws no
            conclusion from them. It does not assess your experience
            against anyone&rsquo;s minimums, whether an insurer&rsquo;s, an
            operator&rsquo;s, or anybody else&rsquo;s, and it does not tell
            you what you may or may not fly. Those judgements belong to
            whoever is asking for this form, under the certificate or the
            policy that governs. This page exists so you can answer their
            questions from one place, instead of a calculator and an
            evening with your logbook. The numbers are exactly as complete
            as the records behind them.
          </div>
        </div>
      </LAlert>

      {report.error ? (
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            {/* THE LOADER'S OWN SENTENCE, verbatim. Every value `error`
                can hold is written for the pilot (queries.ts logs the raw
                database detail and never passes it up), and each says which
                refusal this is: a fleet past its cap, a career past its
                cap, a read that could not be proven complete. Running them
                through friendlyDbError collapsed all of them to "Couldn't
                save that. Try again." — a sentence about writing, on a page
                that only reads, that threw away the one thing the pilot
                needed to know. */}
            <span>{`Sorry, ${report.error}.`}</span>
          </LAlert>
        </LCard>
      ) : data && !data.ok ? (
        <LCard>
          <h2 className="mb-2 text-h3 font-semibold">No figures to state yet</h2>
          <p className="text-body-s text-ink-2">
            Your logbook has no entries, so this page shows no totals. A
            column of 0.0-hour figures would claim something about your
            flying with no record behind it. Log a flight or import your
            history in{" "}
            <NextLink href="/logbook" className="text-accent hover:underline">
              Logbook
            </NextLink>{" "}
            and the figures appear.
          </p>
        </LCard>
      ) : data ? (
        <>
          <LCard>
            <div className="mb-3">
              <h2 className="text-h3 font-semibold">Flight time</h2>
              <p className="text-body-s text-ink-2">
                {`Compiled ${formatDate(data.compiledOn)}. Your logbook runs from ${formatDate(
                  data.earliestEntryDate
                )} to ${formatDate(data.latestEntryDate)}. Simulator time is on its own line and is never added to a total. Every hour above it is time in an aircraft.`}
              </p>
              {/* Almost always a mistyped year. Said out loud, because the
                  entry is in the pilot's logbook and in none of these
                  figures, and they are the only person who can reconcile
                  the two. The wording is report-lib's, so the PDF and the
                  CSV carry the identical sentence — a caveat that appears
                  on the screen and not on the document that travels is the
                  discrepancy, not the fix. */}
              <Caveat text={futureDatedNote(data.futureDatedEntryCount)} />
              <Caveat
                text={unattributedEntriesNote(data.unattributedEntryCount)}
              />
            </div>

            <LTable>
              <thead>
                <tr>
                  <LTh />
                  <LTh numeric>All time</LTh>
                  <LTh numeric>
                    <span className="block">Last 12 months</span>
                    <span className="block font-normal">
                      {data.lastTwelveMonths.window.label}
                    </span>
                  </LTh>
                  <LTh numeric>
                    <span className="block">Last 90 days</span>
                    <span className="block font-normal">
                      {formatDate(data.lastNinetyDays.window.from ?? data.lastNinetyDays.window.to)}
                      {" to "}
                      {formatDate(data.lastNinetyDays.window.to)}
                    </span>
                  </LTh>
                </tr>
              </thead>
              <tbody>
                {hourRows(data.allTime, data.lastTwelveMonths, data.lastNinetyDays).map((row) => (
                  <tr key={row.label}>
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                    >
                      <span className={row.strong ? undefined : "font-normal text-ink-2"}>
                        {row.label}
                      </span>
                      {row.note ? (
                        <div className="text-caption font-normal text-ink-3">{row.note}</div>
                      ) : null}
                    </th>
                    <LTd numeric>
                      <span className={row.strong ? "font-medium text-ink" : "text-ink-2"}>
                        {row.decimals === 0 ? row.allTime : row.allTime.toFixed(1)}
                      </span>
                    </LTd>
                    <LTd numeric>
                      <span className={row.strong ? "font-medium text-ink" : "text-ink-2"}>
                        {row.decimals === 0 ? row.recent : row.recent.toFixed(1)}
                      </span>
                    </LTd>
                    <LTd numeric>
                      <span className={row.strong ? "font-medium text-ink" : "text-ink-2"}>
                        {row.decimals === 0 ? row.ninety : row.ninety.toFixed(1)}
                      </span>
                    </LTd>
                  </tr>
                ))}
              </tbody>
            </LTable>
          </LCard>

          <LCard>
            <div className="mb-3">
              <h2 className="text-h3 font-semibold">Turbine and retractable gear</h2>
              <p className="text-body-s text-ink-2">
                Two lines rated separately on most history forms. Both come
                from what you recorded about each airframe in{" "}
                <NextLink href="/aircraft" className="text-accent hover:underline">
                  your aircraft
                </NextLink>
                , so an aeroplane you have not annotated yet is counted as
                unrecorded rather than as a no.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <FlagFigureRow
                label="Turbine time"
                figure={data.allTime.turbine}
                recentFigure={data.lastTwelveMonths.turbine}
              />
              <FlagFigureRow
                label="Retractable-gear time"
                figure={data.allTime.retractable}
                recentFigure={data.lastTwelveMonths.retractable}
              />
            </div>
          </LCard>

          <BreakdownCard
            title="By category and class"
            caption="From the category and class you recorded against each airframe."
            rows={data.allTime.byCategoryClass}
            withheld={
              data.allTime.categoryClassUnrecorded
                ? "None of your aircraft has a category and class recorded, so there is nothing to break your hours down by yet. Add it on an aircraft and every hour already logged in it is counted under that class."
                : null
            }
          />

          <BreakdownCard
            title="By type"
            caption="Grouped by type rating where you have recorded one, so a rating that covers several models reads as one figure rather than as several short ones."
            rows={data.allTime.byType}
            withheld={null}
          />

          <BreakdownCard
            title="By aircraft"
            /* Per-airframe time answers "how much time do you have in MY
               aeroplane" — an owner's question, and their insurer's. It is
               NOT what an open-pilot warranty is written against: those
               clauses state minimums in total time, in make and model, and
               in turbine/retractable/multi time, none of which is time in
               one registration. Naming the wrong instrument beside a figure
               is the kind of error a professional reader spots instantly. */
            caption={`The figure an owner, or their insurer, asks for on one specific airframe. ${
              data.registeredAircraftCount === 0
                ? "You have no aircraft on file yet."
                : `${data.registeredAircraftCount} aircraft on file.`
            }`}
            rows={data.allTime.byTail}
            withheld={null}
            showLastFlown
          />

          <LCard>
            <div className="mb-3">
              <h2 className="text-h3 font-semibold">Recorded dates</h2>
              <p className="text-body-s text-ink-2">
                Exactly as you entered them in{" "}
                <NextLink href="/documents" className="text-accent hover:underline">
                  Documents
                </NextLink>
                . Nothing here is derived, checked against a registry, or
                calculated from another date. An expiry shown is one you
                typed, not one this page worked out.
              </p>
            </div>

            {data.recordedDates.length === 0 ? (
              <p className="text-body-s text-ink-2">
                You have no medical, flight review, proficiency check or
                certificate on file with a date on it. Add one and it
                appears here and on the downloads.
              </p>
            ) : (
              <>
                <LTable>
                  <thead>
                    <tr>
                      <LTh>Document</LTh>
                      <LTh>Completed</LTh>
                      <LTh>Issued</LTh>
                      <LTh>Expires (as you entered it)</LTh>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recordedDates.map((date, index) => (
                      <tr key={`${date.kind}-${date.label}-${index}`}>
                        <th
                          scope="row"
                          className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{date.label}</span>
                            <LPill tone="neutral">{kindLabels[date.kind] ?? date.kind}</LPill>
                            {date.attribution === "unattributed" ? (
                              <LPill tone="warn">No airman recorded</LPill>
                            ) : null}
                          </div>
                        </th>
                        <LTd>
                          <span className="text-ink-2">{formatDate(date.completedOn)}</span>
                        </LTd>
                        <LTd>
                          <span className="text-ink-2">{formatDate(date.issuedOn)}</span>
                        </LTd>
                        <LTd>
                          <span className="text-ink-2">{formatDate(date.expiresOn)}</span>
                        </LTd>
                      </tr>
                    ))}
                  </tbody>
                </LTable>
                {data.hasUnattributedDates ? (
                  <p className="mt-2 text-caption text-ink-3">
                    A document marked &ldquo;No airman recorded&rdquo; is on
                    this account without saying whose it is. It is listed
                    because it is almost certainly yours on a single-pilot
                    account, but this page will not assert that for you.
                    Open the document and record the airman to remove the
                    mark.
                  </p>
                ) : null}
              </>
            )}
          </LCard>

          <p className="text-caption text-ink-3">{compiledFromFooter(BRAND.name)}</p>
        </>
      ) : null}
    </LPageShell>
  );
}

// ---------------------------------------------------------------------------
// Presentation helpers. No arithmetic beyond report-lib's own exports —
// a figure computed here would be a figure the tests never see.
// ---------------------------------------------------------------------------

/**
 * A caveat that qualifies a figure — rendered only when report-lib has one
 * to make, so a page with nothing to caveat carries no empty apologies.
 * The sentences themselves live in report-lib.ts, beside the arithmetic,
 * because the PDF and the CSV print the identical ones.
 */
function Caveat({
  text,
  tone = "warn",
}: {
  text: string | null;
  tone?: "warn" | "neutral";
}) {
  if (text === null) return null;
  return (
    <div className={cn("text-caption", tone === "warn" ? "text-warn" : "text-ink-3")}>
      {text}
    </div>
  );
}

type HourRow = {
  label: string;
  note?: string;
  allTime: number;
  recent: number;
  ninety: number;
  decimals: 0 | 1;
  strong?: boolean;
};

function hourRows(
  allTime: PilotHistoryFigures,
  recent: PilotHistoryFigures,
  ninety: PilotHistoryFigures
): HourRow[] {
  const a = allTime.hours;
  const r = recent.hours;
  const n = ninety.hours;
  return [
    {
      label: "Total time",
      note: "Time in an aircraft. Simulator hours are below, never in here.",
      allTime: a.total,
      recent: r.total,
      ninety: n.total,
      decimals: 1,
      strong: true,
    },
    { label: "PIC", allTime: a.pic, recent: r.pic, ninety: n.pic, decimals: 1, strong: true },
    { label: "SIC", allTime: a.sic, recent: r.sic, ninety: n.sic, decimals: 1, strong: true },
    { label: "Solo", allTime: a.solo, recent: r.solo, ninety: n.solo, decimals: 1 },
    {
      label: "Dual received",
      allTime: a.dualReceived,
      recent: r.dualReceived,
      ninety: n.dualReceived,
      decimals: 1,
    },
    {
      label: "Instructor given",
      allTime: a.instructorGiven,
      recent: r.instructorGiven,
      ninety: n.instructorGiven,
      decimals: 1,
    },
    {
      label: "Cross country",
      allTime: a.crossCountry,
      recent: r.crossCountry,
      ninety: n.crossCountry,
      decimals: 1,
    },
    { label: "Night", allTime: a.night, recent: r.night, ninety: n.night, decimals: 1 },
    {
      label: "Instrument (actual)",
      allTime: a.instrumentActual,
      recent: r.instrumentActual,
      ninety: n.instrumentActual,
      decimals: 1,
    },
    {
      label: "Instrument (simulated)",
      allTime: a.instrumentSimulated,
      recent: r.instrumentSimulated,
      ninety: n.instrumentSimulated,
      decimals: 1,
    },
    {
      label: "Instrument (total)",
      note: "Actual and simulated added together, for a form that asks for one figure.",
      allTime: totalInstrument(a),
      recent: totalInstrument(r),
      ninety: totalInstrument(n),
      decimals: 1,
    },
    {
      label: "Simulator",
      note: "Its own line. Time in a training device is not time in an aircraft, and every form asks for the two separately.",
      allTime: a.simulator,
      recent: r.simulator,
      ninety: n.simulator,
      decimals: 1,
      strong: true,
    },
    {
      label: "Takeoffs",
      allTime: totalTakeoffs(a),
      recent: totalTakeoffs(r),
      ninety: totalTakeoffs(n),
      decimals: 0,
    },
    {
      label: "Landings",
      allTime: totalLandings(a),
      recent: totalLandings(r),
      ninety: totalLandings(n),
      decimals: 0,
    },
    {
      label: "Night landings",
      allTime: a.nightLandingsFullStop + a.nightLandingsTouchGo,
      recent: r.nightLandingsFullStop + r.nightLandingsTouchGo,
      ninety: n.nightLandingsFullStop + n.nightLandingsTouchGo,
      decimals: 0,
    },
    {
      label: "Logbook entries",
      allTime: a.entryCount,
      recent: r.entryCount,
      ninety: n.entryCount,
      decimals: 0,
    },
  ];
}

/**
 * A three-state figure rendered as three states.
 *
 * The withheld case is the point of this component: when no airframe in
 * the fleet records the flag, `hours` is arithmetically 0.0 and printing
 * it would be a confident, wrong answer on a form. It says so instead.
 */
function FlagFigureRow({
  label,
  figure,
  recentFigure,
}: {
  label: string;
  figure: FlaggedHours;
  recentFigure: FlaggedHours;
}) {
  if (!flagIsAnswerable(figure)) {
    return (
      <div>
        <div className="font-medium text-ink">{label}</div>
        <p className="text-body-s text-ink-2">
          Not recorded. None of your aircraft says one way or the other, so
          there is no figure to give. A 0.0 here would read as an answer
          rather than as a blank.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-medium text-ink">{label}</span>
        <span className="tnum-l text-lead font-bold">{figure.hours.toFixed(1)}</span>
        <span className="tnum-l text-body-s text-ink-2">
          {`${recentFigure.hours.toFixed(1)} in the last 12 months`}
        </span>
      </div>
      {/* THE SHORTFALL NAMES ITS WINDOW. Beside a last-12-months figure, an
          unlabelled all-time shortfall qualifies a number the reader is not
          looking at. */}
      <Caveat text={unrecordedHoursNote(figure, recentFigure)} />
    </div>
  );
}

function BreakdownCard({
  title,
  caption,
  rows,
  withheld,
  showLastFlown,
}: {
  title: string;
  caption: string;
  rows: BreakdownRow[];
  /** Non-null → the section has nothing honest to say; this sentence is
   *  rendered instead of a table of one meaningless row. */
  withheld: string | null;
  showLastFlown?: boolean;
}) {
  return (
    <LCard>
      <div className="mb-3">
        <h2 className="text-h3 font-semibold">{title}</h2>
        <p className="text-body-s text-ink-2">{caption}</p>
      </div>

      {withheld !== null ? (
        <p className="text-body-s text-ink-2">{withheld}</p>
      ) : rows.length === 0 ? (
        <p className="text-body-s text-ink-2">Nothing to show here yet.</p>
      ) : (
        <LTable>
          <thead>
            <tr>
              <LTh>{title.replace("By ", "")}</LTh>
              <LTh numeric>Total</LTh>
              <LTh numeric>PIC</LTh>
              <LTh numeric>SIC</LTh>
              <LTh numeric>Night</LTh>
              <LTh numeric>Sim</LTh>
              {showLastFlown ? <LTh numeric>Last flown</LTh> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th
                  scope="row"
                  className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{row.label}</span>
                    {/* Says WHY a row reads the way it does. Hours logged
                        against an aeroplane that is not on file are still
                        counted — they are just grouped by what was typed
                        on the entry rather than by an airframe. A row can
                        hold both kinds, so the badge marks the rows with
                        NO airframe behind them and the note below marks
                        the mixed ones. */}
                    {row.registered ? null : <LPill tone="neutral">No aircraft on file</LPill>}
                  </div>
                  {row.sublabel ? (
                    <div className="text-caption font-normal text-ink-3">{row.sublabel}</div>
                  ) : null}
                  <Caveat text={mixedProvenanceNote(row)} tone="neutral" />
                </th>
                <LTd numeric>
                  <span className="font-medium text-ink">{row.total.toFixed(1)}</span>
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
                {showLastFlown ? (
                  <LTd>
                    <span className="text-body-s text-ink-2">{formatDate(row.lastFlownOn)}</span>
                  </LTd>
                ) : null}
              </tr>
            ))}
          </tbody>
        </LTable>
      )}
    </LCard>
  );
}

/* ── Inline icons ─────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. */
function InfoIcon({ className }: { className?: string }) {
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
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4" />
      <circle cx="8" cy="4.9" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

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
