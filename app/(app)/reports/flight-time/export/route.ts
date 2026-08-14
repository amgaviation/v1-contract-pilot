import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { csvRow } from "@/lib/csv";
import { flightTimeWindows, todayIso } from "../report-lib";
import { loadFlightTimeReport } from "../queries";

/**
 * The 135.267 flight-time report's own CSV — "hand this to the operator
 * who asks" is the whole premise of /reports/flight-time, and until this
 * route existed a screenshot was the only way to do that. Mirrors the
 * screen table exactly (same windows, same hours, same coverage caveats)
 * and carries the page's own framing sentences VERBATIM rather than
 * re-summarizing them, so the exported artifact stays inside the same
 * no-verdicts line as the page: totals and citations only, never a
 * legality call.
 *
 * Same "right or loudly wrong, never silently partial" discipline as
 * every other export in this app: loadFlightTimeReport already refuses
 * (report.error) rather than totaling a partial logbook read, and this
 * route passes that refusal straight through as a real error response.
 */
export const dynamic = "force-dynamic";

function slugify(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pilot"
  );
}

export async function GET() {
  const { account } = await requireAccount("/reports/flight-time");

  const windows = flightTimeWindows(todayIso());
  const supabase = await createClient();
  const report = await loadFlightTimeReport(supabase, account.id, windows);

  if (report.error) {
    return NextResponse.json(
      { error: "Couldn't load your flight-time figures for export." },
      { status: 500 }
    );
  }
  if (!report.data || !report.data.ok) {
    // Same "no figures, never a page of 0.0s" rule as the screen — an
    // empty logbook gets a real error, not a CSV of zeros presented as if
    // it were a verified total.
    return NextResponse.json(
      {
        error:
          "Your logbook has no entries yet, so there are no totals to export.",
      },
      { status: 400 }
    );
  }

  const rows: string[] = [];
  rows.push(csvRow(["Flight time — cross-operator totals, 14 CFR 135.267"]));
  rows.push(csvRow(["Account", account.legal_name ?? account.id]));
  rows.push(csvRow(["Compiled", todayIso()]));
  rows.push(
    csvRow([
      "Logbook covers",
      report.data.earliestEntryDate,
      "to",
      todayIso(),
    ])
  );
  rows.push(csvRow([]));
  // Verbatim from app/(app)/reports/flight-time/page.tsx's framing
  // callout — the same sentence on screen and in this file, so the
  // exported artifact can never claim more (or less) than the page does.
  rows.push(
    csvRow([
      "Your own cross-operator picture — totals, not a legality call.",
    ])
  );
  rows.push(
    csvRow([
      "14 CFR 135.267 limits a flight crewmember's total flight time in all commercial flying — 500 hours in any calendar quarter, 800 hours in any two consecutive calendar quarters, 1,400 hours in any calendar year, and a per-24-consecutive-hours limit on the day of flight (135.267(a), (b), current text retrieved 11 AUG 2026). Because those limits count your flying for every operator plus any other commercial flying, no single operator can see the whole picture from their own records — this page computes it from your own logbook, so you can answer the “what else have you flown” question a certificate holder must ask before assigning you. Whether an assignment may be accepted is determined under the assigning operator's certificate and the regulation — never by this page, which states totals and nothing more.",
    ])
  );
  rows.push(csvRow([]));

  rows.push(
    csvRow(["Window", "Citation", "From", "To", "Hours", "Entries", "Coverage"])
  );
  for (const figure of report.data.figures) {
    rows.push(
      csvRow([
        figure.window.label,
        figure.window.citation,
        figure.window.from,
        figure.window.to,
        figure.hours.toFixed(1),
        figure.entryCount,
        figure.coverageGapFrom
          ? `Logbook's earliest entry is ${figure.coverageGapFrom} — flying before that isn't in this figure.`
          : "Logbook coverage spans the full window.",
      ])
    );
  }
  rows.push(csvRow([]));
  // Same approximation notes as page.tsx's "How to read these figures"
  // card, condensed to one line each — the export must not omit the
  // caveats that keep the numbers conservative-only.
  rows.push(
    csvRow([
      "Block time, counted whole: trip-derived entries log block (out to in), which runs equal to or slightly longer than 14 CFR 1.1 flight time, and both commercial and personal flying are included — every approximation pushes these totals higher, never lower, than the regulation's own basis.",
    ])
  );
  rows.push(
    csvRow([
      "The trailing-24-hour row totals the last three calendar days, a span that contains every 24-hour window ending now no matter which timezone entries are dated in, so it can only over-cover, never miss flying.",
    ])
  );

  const body = rows.join("");
  const filename = `flight-time-135-267-${todayIso()}-${slugify(
    account.legal_name ?? account.id
  )}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
