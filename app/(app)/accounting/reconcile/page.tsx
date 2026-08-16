import NextLink from "next/link";
import { LAlert, LButton, LCard, LEmpty, lButtonClass } from "@/components/ledger";
import { LField, LInput } from "@/components/ledger/forms";
import { LPageShell } from "@/components/ledger/page-shell";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { rowsOf } from "@/lib/supabase/rows";
import { BRAND } from "@/lib/brand";
import { formatCents } from "@/lib/format";
import { reconciliationTotals } from "../ledger-lib";
import ReconcileBoard, {
  type LedgerLineView,
  type StatementLineView,
} from "./reconcile-board";
import { todayIso } from "../../reports/sales-tax/report-lib";

export const metadata = { title: "Reconcile" };

const LINES_LIMIT = 1000;
// Matches are fetched scoped to the exact lines on screen, in chunks so the
// IN() list never grows unbounded. Each side is uniquely indexed 1:1, so a
// chunk of N ids returns at most N rows — there is no truncation to detect.
const MATCH_ID_CHUNK = 200;

type BankAccountRow = { id: string; label: string; last4: string | null; kind: string };
type TxnRow = {
  id: string;
  posted_on: string;
  description: string;
  amount_cents: number;
  bank_account_id: string;
};
type MatchRow = { id: string; bank_transaction_id: string; journal_line_id: string };
type BankLineRow = {
  journal_line_id: string;
  entry_id: string;
  entry_date: string;
  memo: string;
  source_type: string;
  signed_cents: number;
};

function monthBoundsOf(month: string): { start: string; end: string } {
  const parts = month.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${lastDay < 10 ? `0${lastDay}` : lastDay}`,
  };
}

/**
 * Bank reconciliation, WHOLE-CASH-ACCOUNT. V1's ledger keeps exactly one
 * Cash & bank account (seed_accounts_chart documents why: invoice_payments
 * never record which real-world account money landed in, so per-bank asset
 * accounts could not be funded truthfully). So this trues the AGGREGATE of
 * every imported statement source for the month against that one ledger
 * account — like against like. There is deliberately no per-source picker:
 * comparing one statement against ALL of the book's cash movement would be
 * a false difference, and no configuration is allowed to produce one.
 *
 * The difference figure is (combined statement total) − (ledger Cash & bank
 * total) for the period. Matching pairs (equal amounts by construction)
 * never moves it; RECORDING the missing side does. And a zero difference is
 * only "reconciled" once every line on BOTH sides is matched — a difference
 * that nets to zero over dangling lines is not an explained period.
 */
export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { account } = await requireEntitlement("accounting", "/accounting/reconcile");
  const sp = await searchParams;
  const supabase = await createClient();

  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);

  const bankAccountsResult = rowsOf<BankAccountRow>(
    (await supabase
      .from("bank_accounts")
      .select("id, label, last4, kind")
      .eq("account_id", account.id)
      .is("archived_at", null)
      .order("label", { ascending: true })
      .limit(100)) as never
  );

  if (syncError || !bankAccountsResult.ok) {
    return (
      <LPageShell title="Reconcile">
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>
            Couldn&rsquo;t load your reconciliation data. Nothing is shown
            rather than a screen that pretends there&rsquo;s nothing to
            reconcile.
          </span>
        </LAlert>
      </LPageShell>
    );
  }

  const bankAccounts = bankAccountsResult.rows;
  // Tightened to real months only (01-12) — /^\d{4}-\d{2}$/ let a
  // hand-edited ?month=2026-13 through, monthBoundsOf then built the
  // impossible string "2026-13-01", and the .gte() below failed in
  // Postgres with a date-parse error instead of falling back to the
  // current month like every other malformed param in this route group.
  const month =
    sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : todayIso().slice(0, 7);

  if (bankAccounts.length === 0) {
    return (
      <LPageShell
        title="Reconcile"
        subtitle="Match imported statement lines against your ledger's Cash & bank account."
      >
        <LCard>
          <LEmpty title="No bank statements imported yet">
            Import a bank or card statement under{" "}
            <NextLink
              href="/expenses/import"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Expenses → Import
            </NextLink>{" "}
            first. Reconciliation matches those lines against your ledger.
          </LEmpty>
        </LCard>
      </LPageShell>
    );
  }

  const { start, end } = monthBoundsOf(month);

  // Statements: EVERY source for the period, not one picked account — the
  // aggregate is what reconciles against the single Cash & bank ledger.
  const [txnRes, ledgerRes] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id, posted_on, description, amount_cents, bank_account_id")
      .eq("account_id", account.id)
      .gte("posted_on", start)
      .lte("posted_on", end)
      .order("posted_on", { ascending: true })
      .limit(LINES_LIMIT),
    supabase
      .rpc("ledger_bank_lines", {
        target_account_id: account.id,
        period_start: start,
        period_end: end,
      } as never)
      .limit(LINES_LIMIT),
  ]);

  const txnResult = rowsOf<TxnRow>(txnRes as never);
  const ledgerResult = rowsOf<BankLineRow>(ledgerRes as never);

  // Matches scoped to the exact lines on screen. The old query capped 1000
  // matches across ALL months/sources, so a busy account's currently-shown
  // cleared line could fall outside that page and render as unmatched (then
  // re-matching hit the unique constraint). Fetching by the loaded ids —
  // chunked so the IN() list stays bounded — guarantees a cleared line
  // always shows cleared. 1:1 unique indexes mean a chunk of N ids returns
  // at most N rows, so there is no truncation here to detect.
  let matchResult: ReturnType<typeof rowsOf<MatchRow>> = { ok: true, rows: [] };
  if (txnResult.ok && ledgerResult.ok) {
    const byId = new Map<string, MatchRow>();
    const probes: Array<{ column: "bank_transaction_id" | "journal_line_id"; ids: string[] }> = [];
    const txnIds = txnResult.rows.map((t) => t.id);
    const lineIds = ledgerResult.rows.map((l) => l.journal_line_id);
    for (let i = 0; i < txnIds.length; i += MATCH_ID_CHUNK)
      probes.push({ column: "bank_transaction_id", ids: txnIds.slice(i, i + MATCH_ID_CHUNK) });
    for (let i = 0; i < lineIds.length; i += MATCH_ID_CHUNK)
      probes.push({ column: "journal_line_id", ids: lineIds.slice(i, i + MATCH_ID_CHUNK) });
    for (const probe of probes) {
      if (probe.ids.length === 0) continue;
      const chunk = rowsOf<MatchRow>(
        (await supabase
          .from("bank_statement_matches")
          .select("id, bank_transaction_id, journal_line_id")
          .eq("account_id", account.id)
          .in(probe.column, probe.ids)
          .limit(probe.ids.length + 1)) as never
      );
      if (!chunk.ok) {
        matchResult = chunk;
        break;
      }
      for (const m of chunk.rows) byId.set(m.id, m);
    }
    if (matchResult.ok) matchResult = { ok: true, rows: [...byId.values()] };
  }

  if (!txnResult.ok || !ledgerResult.ok || !matchResult.ok) {
    return (
      <LPageShell title="Reconcile">
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>
            Couldn&rsquo;t load this period&rsquo;s lines. Nothing is shown
            rather than a difference figure that isn&rsquo;t true.
          </span>
        </LAlert>
      </LPageShell>
    );
  }

  // Matches cannot truncate (bounded 1:1 by the loaded ids); only the
  // statement and ledger reads carry the 1000-row cap.
  const truncated =
    txnResult.rows.length === LINES_LIMIT || ledgerResult.rows.length === LINES_LIMIT;

  const matchByTxn = new Map(matchResult.rows.map((m) => [m.bank_transaction_id, m.id]));
  const matchByLine = new Map(matchResult.rows.map((m) => [m.journal_line_id, m.id]));

  const sourceLabel = new Map(
    bankAccounts.map((b) => [b.id, `${b.label}${b.last4 ? ` ••${b.last4}` : ""}`])
  );

  const statementLines: StatementLineView[] = txnResult.rows.map((t) => ({
    id: t.id,
    postedOn: t.posted_on,
    description: t.description,
    amountCents: t.amount_cents,
    source: sourceLabel.get(t.bank_account_id) ?? "Statement",
    matchId: matchByTxn.get(t.id) ?? null,
  }));
  const ledgerLines: LedgerLineView[] = ledgerResult.rows.map((l) => ({
    journalLineId: l.journal_line_id,
    entryDate: l.entry_date,
    memo: l.memo,
    sourceType: l.source_type,
    signedCents: l.signed_cents,
    matchId: matchByLine.get(l.journal_line_id) ?? null,
  }));

  const totals = reconciliationTotals(
    statementLines.map((l) => l.amountCents),
    ledgerLines.map((l) => l.signedCents),
    statementLines.filter((l) => l.matchId !== null).length,
    ledgerLines.filter((l) => l.matchId !== null).length
  );

  const multipleSources = bankAccounts.length > 1;
  const subtitle = multipleSources
    ? `${bankAccounts.length} statement sources · ${month}`
    : `${sourceLabel.get(bankAccounts[0]!.id) ?? "Bank"} · ${month}`;

  return (
    <LPageShell
      title="Reconcile"
      subtitle={subtitle}
      action={
        <NextLink href="/accounting" className={lButtonClass({ variant: "outline" })}>
          Chart of accounts
        </NextLink>
      }
    >
      <LCard>
        <form method="get" action="/accounting/reconcile">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <LField label="Month" htmlFor="rec-month">
                <LInput id="rec-month" type="month" name="month" defaultValue={month} />
              </LField>
            </div>
            <LButton type="submit" variant="outline">
              View period
            </LButton>
          </div>
        </form>
      </LCard>

      <LAlert tone="accent" className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 shrink-0 text-accent" />
        <span>
          {multipleSources ? (
            <>
              {BRAND.name} keeps one Cash &amp; bank ledger account, so
              reconciliation trues your combined statements, all{" "}
              {bankAccounts.length} imported sources together, against it for
              the month. Per-account reconciliation would need a bank
              dimension on the ledger, which isn&rsquo;t built. The
              difference below compares every statement line against your
              book cash, like with like.
            </>
          ) : (
            <>
              {BRAND.name} keeps one Cash &amp; bank ledger account, so
              reconciliation trues this statement against it for the month.
              Per-account reconciliation needs a bank dimension on the
              ledger, which isn&rsquo;t built.
            </>
          )}
        </span>
      </LAlert>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LCard>
          <div className="text-caption text-ink-3">Statement total</div>
          <div className="tnum-l text-h2 font-bold tracking-tight">
            {formatCents(totals.statementTotalCents)}
          </div>
        </LCard>
        <LCard>
          <div className="text-caption text-ink-3">Ledger total</div>
          <div className="tnum-l text-h2 font-bold tracking-tight">
            {formatCents(totals.ledgerTotalCents)}
          </div>
        </LCard>
        <LCard>
          <div className="text-caption text-ink-3">Difference (statement − ledger)</div>
          <div
            className={
              "tnum-l text-h2 font-bold tracking-tight " +
              (totals.reconciled
                ? "text-good"
                : totals.differenceCents === 0
                  ? "text-warn"
                  : "text-crit")
            }
          >
            {formatCents(totals.differenceCents)}
          </div>
          {totals.reconciled ? (
            <p className="mt-1 text-caption text-good">
              Reconciled. Every line is matched, and the books fully explain
              this period.
            </p>
          ) : totals.differenceCents === 0 ? (
            <p className="mt-1 text-caption text-warn">
              The totals net to zero, but {totals.unmatchedStatementCount}{" "}
              statement and {totals.unmatchedLedgerCount} ledger line
              {totals.unmatchedStatementCount + totals.unmatchedLedgerCount === 1
                ? ""
                : "s"}{" "}
              are still unmatched. They only cancel out. Match every line
              before this period reads as reconciled.
            </p>
          ) : (
            <p className="mt-1 text-caption text-ink-3">
              Record the missing side (confirm an expense, record a payment,
              or add a journal entry) to bring this to zero. Matching alone
              never moves it.
            </p>
          )}
        </LCard>
      </div>

      {truncated ? (
        <LAlert tone="warn" className="flex items-start gap-2">
          <InfoIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            This period has more lines than one screen can safely total. The
            difference figure above may be incomplete. Narrow to a month with
            fewer lines.
          </span>
        </LAlert>
      ) : null}

      <ReconcileBoard statementLines={statementLines} ledgerLines={ledgerLines} />
    </LPageShell>
  );
}

/* ── Inline icons ──────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shapes as accounting/journal/page.tsx's own. */
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
