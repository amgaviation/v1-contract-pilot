import NextLink from "next/link";
import { LAlert, LCard, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { flightTimeWindows, todayIso } from "./report-lib";
import { loadFlightTimeReport } from "./queries";

export const metadata = { title: "Flight time" };

/**
 * Cross-operator flight-time totals in 14 CFR 135.267's own windows.
 * TOTALS ONLY — no legality verdicts, no remaining-hours math; see
 * report-lib.ts's header for the verified reg text (retrieved 2026-08-11)
 * and the design decisions, and docs/LAUNCH-GATES.md for why verdict
 * wording sits behind the counsel gate.
 */
export default async function FlightTimeReportPage() {
  const { account } = await requireAccount("/reports/flight-time");

  const windows = flightTimeWindows(todayIso());
  const supabase = await createClient();
  const report = await loadFlightTimeReport(supabase, account.id, windows);

  // Only offered once there are figures to hand someone — an empty logbook
  // has nothing this report can honestly export, matching the "no
  // figures, never a page of 0.0s" rule the screen itself follows.
  const canExport = report.data && report.data.ok;

  return (
    <LPageShell
      title="Flight time"
      subtitle="Cross-operator totals · 14 CFR 135.267"
      action={
        canExport ? (
          <a href="/reports/flight-time/export" download className={lButtonClass({ variant: "outline" })}>
            Download CSV
          </a>
        ) : undefined
      }
    >
      {/* LOAD-BEARING, deliberately first — the same placement as the
          year-end report's framing callout: what this page is and is not,
          above every figure on it. */}
      <LAlert tone="accent" className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 shrink-0 text-accent" />
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink">
            Your own cross-operator picture: totals, not a legality call.
          </p>
          <p className="text-body-s">
            14 CFR 135.267 limits how much a flight crewmember can fly commercially, counting
            every operator together: 500 hours in any calendar quarter, 800 hours in any two
            consecutive calendar quarters, 1,400 hours in any calendar year, and a separate
            limit on hours in any 24 consecutive hours on the day of flight. (135.267(a), (b),
            current text retrieved 11 AUG 2026) Because those limits count your flying for
            every operator, plus any other commercial flying, no single operator can see the
            whole picture from their own records. This page computes it from your own logbook,
            so you can answer the &ldquo;what else have you flown&rdquo; question a certificate
            holder must ask before assigning you. Whether an assignment may be accepted is
            decided under the assigning operator&rsquo;s certificate and the regulation, never
            by this page. This page states totals only.
          </p>
        </div>
      </LAlert>

      {report.error ? (
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError({ message: report.error }, "flight-time.load")}</span>
          </LAlert>
        </LCard>
      ) : report.data && !report.data.ok ? (
        <LCard>
          <p className="mb-2 text-h3 font-semibold">No figures to state yet</p>
          <p className="text-body-s text-ink-2">
            Your logbook has no entries, so this page shows no totals. A row of 0.0-hour
            figures would claim something about your flying with no record behind it. Log a
            flight or import your history in{" "}
            <NextLink href="/logbook" className="text-accent hover:underline">
              Logbook
            </NextLink>{" "}
            and the totals appear.
          </p>
        </LCard>
      ) : report.data ? (
        <div className="flex flex-col gap-4">
          <LCard>
            <div className="mb-3">
              <p className="text-h3 font-semibold">Logged flight time, by 135.267 window</p>
              <p className="text-body-s text-ink-2">
                Every logbook entry&rsquo;s aircraft time, by the entry&rsquo;s own date.
                Simulator sessions are excluded. Your logbook covers{" "}
                {formatDate(report.data.earliestEntryDate)} to today.
              </p>
            </div>

            <LTable>
              <caption>
                <span className="sr-only">Flight time by window</span>
              </caption>
              <thead>
                <tr>
                  <LTh>Window</LTh>
                  <LTh>Dates</LTh>
                  <LTh numeric>Hours</LTh>
                  <LTh numeric>Entries</LTh>
                  <LTh>Coverage</LTh>
                </tr>
              </thead>
              <tbody>
                {report.data.figures.map((figure) => (
                  <tr key={figure.window.key}>
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                    >
                      <span className="block">{figure.window.label}</span>
                      <span className="block text-caption font-normal text-ink-3">
                        {figure.window.citation}
                      </span>
                    </th>
                    <LTd>
                      <span className="text-ink-2">
                        {formatDate(figure.window.from)} to {formatDate(figure.window.to)}
                      </span>
                    </LTd>
                    <LTd numeric>
                      <span className="font-medium">{figure.hours.toFixed(1)}</span>
                    </LTd>
                    <LTd numeric>
                      <span className="text-ink-3">{figure.entryCount}</span>
                    </LTd>
                    <LTd>
                      {figure.coverageGapFrom ? (
                        <span className="text-caption text-warn">
                          Your logbook&rsquo;s earliest entry is{" "}
                          {formatDate(figure.coverageGapFrom)}. Flying before that isn&rsquo;t
                          in this figure, so it can&rsquo;t be read as the window&rsquo;s full
                          total.
                        </span>
                      ) : (
                        <span className="text-caption text-ink-3">
                          Logbook coverage spans the full window.
                        </span>
                      )}
                    </LTd>
                  </tr>
                ))}
              </tbody>
            </LTable>
          </LCard>

          <LCard>
            <p className="mb-2 text-h3 font-semibold">How to read these figures</p>
            <div className="flex flex-col gap-2">
              <p className="text-body-s text-ink-2">
                <span className="font-medium text-ink">Block time, counted whole.</span>{" "}
                Trip-derived entries log block time (out to in), which runs equal to or slightly
                longer than flight time as 14 CFR 1.1 defines it. Your logbook also doesn&rsquo;t
                separate commercial from personal flying, so both are included. Each
                approximation pushes these totals higher, never lower, than the
                regulation&rsquo;s own basis.
              </p>
              <p className="text-body-s text-ink-2">
                <span className="font-medium text-ink">
                  The three-calendar-day row stands in for the 24-hour window.
                </span>{" "}
                Logbook entries carry a date, not takeoff and landing times, so a clock-exact
                24-consecutive-hour total can&rsquo;t be computed from them. The first row
                totals your last three calendar days instead. That span contains every 24-hour
                window ending now, no matter which timezone you log dates in, so it can only
                over-cover flying, never miss it.
              </p>
              <p className="text-body-s text-ink-2">
                <span className="font-medium text-ink">
                  Keep the logbook current to keep this current.
                </span>{" "}
                These totals are exactly as complete as your logbook. Flying you haven&rsquo;t
                logged yet isn&rsquo;t in them.
              </p>
            </div>
          </LCard>
        </div>
      ) : null}
    </LPageShell>
  );
}

/* ── Inline icons ──────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shapes as invoices/page.tsx and
 * invoices/recurring/schedule-form.tsx's own copies. */
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
