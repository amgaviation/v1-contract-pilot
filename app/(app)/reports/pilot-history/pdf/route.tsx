import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { PilotHistoryPdf } from "@/lib/pilot-history-pdf";
import { todayIso } from "../report-lib";
import { loadPilotHistoryReport } from "../queries";

// @react-pdf/renderer needs Node APIs (its layout engine, fontkit) — not
// available on the Edge runtime. The same requirement the invoice PDF route
// records, for the same reason.
export const runtime = "nodejs";
// A fresh document reflecting the logbook and the documents as they stand
// right now, never a cached artifact. A pilot who logs a flight and then
// re-downloads this must get the new figure.
export const dynamic = "force-dynamic";

/**
 * The pilot-history report as a PDF — the thing a pilot actually attaches
 * to an underwriter's email or hands a chief pilot.
 *
 * EVERYTHING THAT CAN FAIL IS RESOLVED BEFORE THE FIRST BYTE, the same
 * discipline as the invoice PDF route and the year-end export: the report
 * is loaded, every error is turned into a status code, and only then is the
 * document rendered. There is no streaming case to design for here and
 * that is the point — a partial 200 carrying a plausible-looking history
 * form would be far worse than a 500, because the pilot forwards it
 * without opening it.
 *
 * The route holds only HTTP concerns. The figures come from the same
 * loader and the same pure module the screen renders from, so the PDF and
 * the page cannot disagree — two code paths producing one pilot's total
 * time is precisely the drift lib/invoice-document.tsx exists to prevent
 * for invoices.
 */
function slugify(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pilot"
  );
}

export async function GET(_request: NextRequest) {
  const { account, user } = await requireAccount("/reports/pilot-history");

  const today = todayIso();
  const supabase = await createClient();
  const [report, kindLabels] = await Promise.all([
    loadPilotHistoryReport(supabase, account.id, user.id, today),
    loadOptionLabels("document_kind"),
  ]);

  if (report.error || !report.data) {
    console.error("[pilot-history pdf] report load failed", report.error);
    return NextResponse.json(
      { error: "Couldn't compile your pilot history right now." },
      { status: 500 }
    );
  }

  // An empty logbook is not an error, and it is also not a document. A PDF
  // of zeroes on a pilot's letterhead is a statement about their flying
  // that no record supports — the screen says so in words, and this refuses
  // to produce the artifact at all.
  if (!report.data.ok) {
    return NextResponse.json(
      {
        error:
          "There are no logbook entries to compile yet, so there is no history to download.",
      },
      { status: 409 }
    );
  }

  const data = report.data;
  const buffer = await renderToBuffer(
    <PilotHistoryPdf
      account={{
        legal_name: account.legal_name,
        address_line1: account.address_line1,
        address_line2: account.address_line2,
        city: account.city,
        state: account.state,
        postal_code: account.postal_code,
        country: account.country,
      }}
      compiledOn={data.compiledOn}
      earliestEntryDate={data.earliestEntryDate}
      latestEntryDate={data.latestEntryDate}
      futureDatedEntryCount={data.futureDatedEntryCount}
      unattributedEntryCount={data.unattributedEntryCount}
      registeredAircraftCount={data.registeredAircraftCount}
      allTime={data.allTime}
      lastTwelveMonths={data.lastTwelveMonths}
      recordedDates={data.recordedDates}
      hasUnattributedDates={data.hasUnattributedDates}
      kindLabels={kindLabels}
    />
  );

  const filename = `pilot-history-${slugify(account.legal_name ?? account.id)}-${today}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      // Never cache a compiled record.
      "Cache-Control": "no-store",
    },
  });
}
