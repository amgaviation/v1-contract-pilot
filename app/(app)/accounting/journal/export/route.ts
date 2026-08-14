import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { rowsOf, type DbErrorLike } from "@/lib/supabase/rows";
import { csvRow } from "@/lib/csv";
import {
  GENERAL_LEDGER_HEADER,
  assembleGeneralLedger,
  generalLedgerRowValues,
  slugify,
  type ChartAccountLite,
  type JournalEntryLite,
  type JournalLineLite,
} from "@/lib/accounting-export";

// Always the current book, never a cached artifact — same posture as
// /logbook/export and /settings/export/[entity].
export const dynamic = "force-dynamic";

/**
 * The full general ledger, one CSV: every posting line across every
 * journal entry, CPA-shaped (see lib/accounting-export.ts's header for
 * why: one row per line, separate Debit/Credit columns, balanced pairs
 * adjacent). Unlike the on-screen /accounting/journal, which caps at the
 * 200 most recent entries so the page stays fast, this export has no cap
 * — an accountant reconciling a full tax year needs the whole book, not
 * the most recent slice of it.
 *
 * PostgREST/the Supabase client default-caps a single request's rows and
 * TRUNCATES SILENTLY rather than erroring — the same caveat every export
 * route in this product carries. Entries, lines and the chart are each
 * paged to completeness with .range() before anything is assembled, so
 * "no row cap" is actually true here rather than inherited as a silent
 * truncation.
 *
 * Assembly (the sort that keeps balanced pairs adjacent, and the account/
 * source-reference lookups) is buffered fully in memory rather than
 * streamed lazily, unlike /settings/export/[entity]: a journal line's
 * position in the file depends on its ENTRY's date, so the whole set has
 * to be read before the first row can be written in the right order. A
 * solo contract pilot's journal is bounded in a way a bank-transaction or
 * invoice-line table is not (every line here comes from a two-line-
 * minimum, thirty-line-maximum manual entry or a handful of lines per
 * invoice/payment/expense/mileage row), so buffering the whole thing is
 * the honest trade here.
 */
const PAGE_SIZE = 500;

type Fetched<T> = { ok: true; rows: T[] } | { ok: false; what: string; error: DbErrorLike };

async function fetchAll<T>(
  what: string,
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbErrorLike | null }>
): Promise<Fetched<T>> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const result = rowsOf(await query(offset, offset + PAGE_SIZE - 1));
    if (!result.ok) return { ok: false, what, error: result.error };
    all.push(...result.rows);
    offset += result.rows.length;
    if (result.rows.length < PAGE_SIZE) return { ok: true, rows: all };
  }
}

export async function GET(_request: NextRequest) {
  const { account } = await requireEntitlement("accounting", "/accounting/journal");
  const supabase = await createClient();

  // Sync first, same as the journal screen — the export must reflect
  // every fact the app already knows, not a book that's one edit stale.
  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);
  if (syncError) {
    console.error("[journal export] ledger_sync failed", syncError);
    return NextResponse.json(
      { error: "Couldn't bring the ledger up to date, so no file was produced. Try again in a moment." },
      { status: 500 }
    );
  }

  // Everything that can fail cleanly fails BEFORE the first byte — same
  // "read everything, then decide, then write" discipline as every other
  // export route in this product.
  const [entriesResult, linesResult, chartResult] = await Promise.all([
    fetchAll<JournalEntryLite>("journal entries", (from, to) =>
      supabase
        .from("journal_entries")
        .select("id, entry_date, memo, source_type, source_id, created_at")
        .eq("account_id", account.id)
        .order("id", { ascending: true })
        .range(from, to) as never
    ),
    fetchAll<JournalLineLite>("journal lines", (from, to) =>
      supabase
        .from("journal_lines")
        .select("id, entry_id, chart_account_id, side, amount_cents, line_no")
        .eq("account_id", account.id)
        .order("id", { ascending: true })
        .range(from, to) as never
    ),
    fetchAll<ChartAccountLite>("chart of accounts", (from, to) =>
      supabase
        .from("accounts_chart")
        .select("id, name, system_key")
        .eq("account_id", account.id)
        .order("id", { ascending: true })
        .range(from, to) as never
    ),
  ]);

  const failed = !entriesResult.ok
    ? entriesResult
    : !linesResult.ok
      ? linesResult
      : !chartResult.ok
        ? chartResult
        : null;
  if (failed) {
    console.error(`[journal export] ${failed.what} fetch failed`, failed.error);
    return NextResponse.json(
      {
        error:
          `Couldn't load the ${failed.what} this export needs, so no file was produced. ` +
          "A download with rows silently missing would look complete and be wrong. Try again in a moment.",
      },
      { status: 500 }
    );
  }
  // Narrowed ok by `failed === null` above; TypeScript can't see through
  // that across three independent unions, so assert the shape here once.
  const entries = (entriesResult as { ok: true; rows: JournalEntryLite[] }).rows;
  const lines = (linesResult as { ok: true; rows: JournalLineLite[] }).rows;
  const chart = (chartResult as { ok: true; rows: ChartAccountLite[] }).rows;

  const chartById = new Map(chart.map((c) => [c.id, c]));
  const ledgerLines = assembleGeneralLedger(entries, lines, chartById);

  const encoder = new TextEncoder();
  const bodyChunks = ledgerLines.map((line) => csvRow(generalLedgerRowValues(line)));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(csvRow([...GENERAL_LEDGER_HEADER])));
      for (const chunk of bodyChunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `general-ledger-${slugify(account.legal_name ?? account.id)}-${today}.csv`;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
