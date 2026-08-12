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
// 200 entries per page of history; their lines at the API's own 1000 cap.
const ENTRIES_LIMIT = 200;
const LINES_LIMIT = 1000;
const CHART_LIMIT = 1000;

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
  archived_at: string | null;
};

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
      .select("id, name, kind, archived_at")
      .eq("account_id", account.id)
      .limit(CHART_LIMIT),
  ]);

  const entriesResult = rowsOf<EntryRow>(entriesRes as never);
  const chartResult = rowsOf<ChartRow>(chartRes as never);

  let linesResult: ReturnType<typeof rowsOf<LineRow>> = { ok: true, rows: [] };
  if (entriesResult.ok && entriesResult.rows.length > 0) {
    const ids = entriesResult.rows.map((e) => e.id);
    linesResult = rowsOf<LineRow>(
      (await supabase
        .from("journal_lines")
        .select("id, entry_id, chart_account_id, side, amount_cents, line_no")
        .eq("account_id", account.id)
        .in("entry_id", ids)
        .order("line_no", { ascending: true })
        .limit(LINES_LIMIT)) as never
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
    .map((c) => ({ id: c.id, name: c.name, kindLabel: KIND_LABEL[c.kind] }));

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

  const truncated =
    (entriesResult.ok && entriesResult.rows.length === ENTRIES_LIMIT) ||
    (linesResult.ok && linesResult.rows.length === LINES_LIMIT);

  return (
    <PageShell
      title="Journal"
      subtitle="Every ledger entry — derived from your records automatically, plus your own."
      action={
        <Button asChild variant="soft" size="2">
          <NextLink href="/accounting">Chart of accounts</NextLink>
        </Button>
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
                Showing the most recent {ENTRIES_LIMIT} entries — older history
                exists but isn&rsquo;t listed here. The reports still count
                everything.
              </Callout.Text>
            </Callout.Root>
          ) : null}
          <JournalList entries={entries} />
        </Flex>
      )}
    </PageShell>
  );
}
