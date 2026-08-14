import NextLink from "next/link";
import { Button, Callout, Flex } from "@/components/ui";
import { ExclamationTriangleIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { rowsOf } from "@/lib/supabase/rows";
import PageShell from "../../page-shell";
import { KIND_LABEL, type ChartKind } from "../ledger-lib";
import JournalEntryForm, { type AccountOption } from "./journal-entry-form";
import JournalList, { type JournalEntryView } from "./journal-list";

export const metadata = { title: "Journal" };

// Same Data API discipline as every report: explicit limits, truncation
// detected by exact equality, and a truncated list SAYS so on screen.
// 200 entries per page of history. Their lines are fetched SCOPED to those
// entries and PAGED to completeness (see fetchLinesForEntries): a single
// 1000-row cap over 200 entries could slice an entry's debits from its
// credits and render it falsely unbalanced, which for a ledger is a lie
// about money. An entry is shown with all its lines or the read fails.
const ENTRIES_LIMIT = 200;
const CHART_LIMIT = 1000;
// The IN() list is chunked so it never grows unbounded; each chunk is paged
// at the API's own 1000-row ceiling until a short page proves completeness.
const ENTRY_ID_CHUNK = 100;
const LINE_PAGE = 1000;

type EntryRow = {
  id: string;
  entry_date: string;
  memo: string;
  source_type: string;
};
type LineRow = {
  id: string;
  entry_id: string;
  chart_account_id: string;
  side: "debit" | "credit";
  amount_cents: number;
  line_no: number;
};
type ChartRow = {
  id: string;
  name: string;
  kind: ChartKind;
  system_key: string | null;
  archived_at: string | null;
};

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Every journal line for the given entries, chunked and paged to
 * completeness so no shown entry is ever missing lines. A failed page fails
 * the whole read (rows.ts discipline) — better to refuse than to render a
 * partial, seemingly-unbalanced entry.
 */
async function fetchLinesForEntries(
  supabase: SupabaseClient,
  accountId: string,
  entryIds: string[]
): Promise<ReturnType<typeof rowsOf<LineRow>>> {
  const all: LineRow[] = [];
  for (let i = 0; i < entryIds.length; i += ENTRY_ID_CHUNK) {
    const chunk = entryIds.slice(i, i + ENTRY_ID_CHUNK);
    let from = 0;
    for (;;) {
      const page = rowsOf<LineRow>(
        (await supabase
          .from("journal_lines")
          .select("id, entry_id, chart_account_id, side, amount_cents, line_no")
          .eq("account_id", accountId)
          .in("entry_id", chunk)
          .order("entry_id", { ascending: true })
          .order("line_no", { ascending: true })
          .range(from, from + LINE_PAGE - 1)) as never
      );
      if (!page.ok) return page;
      all.push(...page.rows);
      if (page.rows.length < LINE_PAGE) break;
      from += LINE_PAGE;
    }
  }
  return { ok: true, rows: all };
}

export default async function JournalPage() {
  const { account } = await requireEntitlement("accounting", "/accounting/journal");
  const supabase = await createClient();

  // The on-demand derivation pass — idempotent by unique index, so safe on
  // every load; this is what keeps the journal current with the app's facts.
  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);

  const [entriesRes, chartRes] = await Promise.all([
    supabase
      .from("journal_entries")
      .select("id, entry_date, memo, source_type")
      .eq("account_id", account.id)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(ENTRIES_LIMIT),
    supabase
      .from("accounts_chart")
      .select("id, name, kind, system_key, archived_at")
      .eq("account_id", account.id)
      .limit(CHART_LIMIT),
  ]);

  const entriesResult = rowsOf<EntryRow>(entriesRes as never);
  const chartResult = rowsOf<ChartRow>(chartRes as never);

  let linesResult: ReturnType<typeof rowsOf<LineRow>> = { ok: true, rows: [] };
  if (entriesResult.ok && entriesResult.rows.length > 0) {
    linesResult = await fetchLinesForEntries(
      supabase,
      account.id,
      entriesResult.rows.map((e) => e.id)
    );
  }

  const failed =
    Boolean(syncError) || !entriesResult.ok || !chartResult.ok || !linesResult.ok;

  const chartById = new Map(
    (chartResult.ok ? chartResult.rows : []).map((c) => [c.id, c])
  );
  const accountOptions: AccountOption[] = (chartResult.ok ? chartResult.rows : [])
    .filter((c) => c.archived_at === null)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      kindLabel: KIND_LABEL[c.kind],
      systemKey: c.system_key,
    }));

  const linesByEntry = new Map<string, LineRow[]>();
  for (const line of linesResult.ok ? linesResult.rows : []) {
    const list = linesByEntry.get(line.entry_id) ?? [];
    list.push(line);
    linesByEntry.set(line.entry_id, list);
  }

  const entries: JournalEntryView[] = (entriesResult.ok ? entriesResult.rows : []).map(
    (e) => ({
      id: e.id,
      entryDate: e.entry_date,
      memo: e.memo,
      sourceType: e.source_type,
      lines: (linesByEntry.get(e.id) ?? []).map((l) => ({
        id: l.id,
        accountName: chartById.get(l.chart_account_id)?.name ?? "(account)",
        side: l.side,
        amountCents: l.amount_cents,
      })),
    })
  );

  // Only the entry list can truncate now — its lines are fetched complete,
  // so a shown entry is never partial. The banner is honest about older
  // history not being listed, nothing more.
  const truncated = entriesResult.ok && entriesResult.rows.length === ENTRIES_LIMIT;

  return (
    <PageShell
      title="Journal"
      subtitle="Every ledger entry, derived from your records automatically, plus your own."
      action={
        <Flex gap="2">
          {/* Plain <a href download>, not a client-side link — it's a file
              download, same pattern as /settings/export and /logbook. */}
          <Button asChild variant="outline" size="2">
            <a href="/accounting/journal/export" download>
              Download CSV
            </a>
          </Button>
          <Button asChild variant="soft" size="2">
            <NextLink href="/accounting">Chart of accounts</NextLink>
          </Button>
        </Flex>
      }
    >
      {failed ? (
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Couldn&rsquo;t load the journal. Nothing below is shown rather than
            showing an empty ledger that isn&rsquo;t true.
          </Callout.Text>
        </Callout.Root>
      ) : (
        <Flex direction="column" gap="4">
          <JournalEntryForm accounts={accountOptions} />
          {truncated ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                Showing the most recent {ENTRIES_LIMIT} entries. Older
                history exists but isn&rsquo;t listed here. The reports
                still count everything.
              </Callout.Text>
            </Callout.Root>
          ) : null}
          <JournalList entries={entries} />
        </Flex>
      )}
    </PageShell>
  );
}
