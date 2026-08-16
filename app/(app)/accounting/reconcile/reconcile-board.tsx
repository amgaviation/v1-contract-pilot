"use client";

import { useState, useTransition, type InputHTMLAttributes } from "react";
import { LButton, LCard, LPill, LTd } from "@/components/ledger";
import { cn } from "@/lib/ledger/cn";
import { formatCents, formatDate } from "@/lib/format";
import { matchStatementLine, unmatchStatementLine } from "./actions";

export type StatementLineView = {
  id: string;
  postedOn: string;
  description: string;
  amountCents: number;
  /** Which imported statement this line came from — shown because the board
   *  aggregates every source against the one Cash & bank ledger account. */
  source: string;
  matchId: string | null;
};

export type LedgerLineView = {
  journalLineId: string;
  entryDate: string;
  memo: string;
  sourceType: string;
  signedCents: number;
  matchId: string | null;
};

/**
 * A plain radio input in Ledger's accent, local to this file: the only
 * place in the migrated accounting surface a radio (not a checkbox or a
 * switch) is needed, so it doesn't earn a components/ledger primitive —
 * see components/ledger/forms.tsx's LCheckbox for the sibling shape this
 * borrows `accent-accent` from.
 */
function LRadio({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <input
      type="radio"
      className={cn(
        "size-4 shrink-0 border border-hair-strong bg-card accent-accent " +
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
          "disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

/**
 * Two columns: the statement as the bank wrote it, and the ledger's
 * Cash & bank lines for the same period. Select one UNMATCHED row on each
 * side, match them; the database refuses unequal amounts, so the button
 * also refuses locally with the same rule rather than inviting a failure.
 * Matched pairs are struck from both columns' working sets and listed
 * with an unmatch action.
 */
export default function ReconcileBoard({
  statementLines,
  ledgerLines,
}: {
  statementLines: StatementLineView[];
  ledgerLines: LedgerLineView[];
}) {
  const [selectedTxn, setSelectedTxn] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const unmatchedStatement = statementLines.filter((l) => l.matchId === null);
  const unmatchedLedger = ledgerLines.filter((l) => l.matchId === null);
  const matchedPairs = statementLines
    .filter((l) => l.matchId !== null)
    .map((statement) => ({
      statement,
      ledger: ledgerLines.find((g) => g.matchId === statement.matchId) ?? null,
    }));

  const txn = unmatchedStatement.find((l) => l.id === selectedTxn) ?? null;
  const line = unmatchedLedger.find((l) => l.journalLineId === selectedLine) ?? null;
  const amountsAgree = txn !== null && line !== null && txn.amountCents === line.signedCents;

  function handleMatch() {
    if (!txn || !line) return;
    startTransition(async () => {
      setError(null);
      const result = await matchStatementLine(txn.id, line.journalLineId);
      if (result.error) setError(result.error);
      else {
        setSelectedTxn(null);
        setSelectedLine(null);
      }
    });
  }

  function handleUnmatch(matchId: string) {
    startTransition(async () => {
      setError(null);
      const result = await unmatchStatementLine(matchId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <LButton
          type="button"
          disabled={pending || !txn || !line || !amountsAgree}
          onClick={handleMatch}
        >
          {pending ? "Working…" : "Match selected pair"}
        </LButton>
        {txn && line && !amountsAgree ? (
          <span className="text-caption text-warn">
            Amounts must be identical to match ({formatCents(txn.amountCents)} vs{" "}
            {formatCents(line.signedCents)}).
          </span>
        ) : (
          <span className="text-caption text-ink-3">
            Select one line in each column, then match. Money in is positive,
            money out negative. Both sides use the same sign.
          </span>
        )}
      </div>
      {error ? (
        <p className="text-caption font-medium text-crit" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LCard>
          <div className="mb-2 text-body font-semibold">
            Statement lines ({unmatchedStatement.length} unmatched)
          </div>
          {unmatchedStatement.length === 0 ? (
            <p className="text-body-s text-ink-3">
              Every statement line in this period is matched.
            </p>
          ) : (
            <table className="w-full border-collapse text-body-s">
              <caption>
                <span className="sr-only">Unmatched statement lines</span>
              </caption>
              <tbody>
                {unmatchedStatement.map((l) => (
                  <tr key={l.id}>
                    <LTd className="border-b-0 py-1.5">
                      <label className="flex items-center gap-2">
                        <LRadio
                          name="statement-line"
                          checked={selectedTxn === l.id}
                          onChange={() => setSelectedTxn(l.id)}
                          aria-label={`${formatDate(l.postedOn)} ${l.description} ${formatCents(l.amountCents)}`}
                        />
                        <span className="text-ink-3">{formatDate(l.postedOn)}</span>
                        <span className="text-ink">{l.description}</span>
                        <span className="text-ink-3">· {l.source}</span>
                      </label>
                    </LTd>
                    <LTd numeric className="border-b-0 py-1.5">
                      <span className={l.amountCents < 0 ? "text-crit" : "text-good"}>
                        {formatCents(l.amountCents)}
                      </span>
                    </LTd>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </LCard>

        <LCard>
          <div className="mb-2 text-body font-semibold">
            Ledger Cash &amp; bank lines ({unmatchedLedger.length} unmatched)
          </div>
          {unmatchedLedger.length === 0 ? (
            <p className="text-body-s text-ink-3">
              Every ledger cash line in this period is matched.
            </p>
          ) : (
            <table className="w-full border-collapse text-body-s">
              <caption>
                <span className="sr-only">Unmatched ledger lines</span>
              </caption>
              <tbody>
                {unmatchedLedger.map((l) => (
                  <tr key={l.journalLineId}>
                    <LTd className="border-b-0 py-1.5">
                      <label className="flex items-center gap-2">
                        <LRadio
                          name="ledger-line"
                          checked={selectedLine === l.journalLineId}
                          onChange={() => setSelectedLine(l.journalLineId)}
                          aria-label={`${formatDate(l.entryDate)} ${l.memo} ${formatCents(l.signedCents)}`}
                        />
                        <span className="text-ink-3">{formatDate(l.entryDate)}</span>
                        <span className="text-ink">{l.memo}</span>
                      </label>
                    </LTd>
                    <LTd numeric className="border-b-0 py-1.5">
                      <span className={l.signedCents < 0 ? "text-crit" : "text-good"}>
                        {formatCents(l.signedCents)}
                      </span>
                    </LTd>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </LCard>
      </div>

      <LCard>
        <div className="mb-2 text-body font-semibold">Matched ({matchedPairs.length})</div>
        {matchedPairs.length === 0 ? (
          <p className="text-body-s text-ink-3">Nothing matched in this period yet.</p>
        ) : (
          <table className="w-full border-collapse text-body-s">
            <caption>
              <span className="sr-only">Matched lines</span>
            </caption>
            <tbody>
              {matchedPairs.map(({ statement, ledger }) => (
                <tr key={statement.id}>
                  <LTd className="border-b-0 py-1.5">
                    <span className="text-ink">
                      {formatDate(statement.postedOn)}: {statement.description}
                    </span>
                    <span className="text-ink-3"> · {statement.source}</span>
                  </LTd>
                  <LTd className="border-b-0 py-1.5">
                    <span className="text-ink-3">
                      {ledger ? ledger.memo : "(ledger line outside this period)"}
                    </span>
                  </LTd>
                  <LTd numeric className="border-b-0 py-1.5">
                    {formatCents(statement.amountCents)}
                  </LTd>
                  <LTd numeric className="border-b-0 py-1.5">
                    <LPill tone="good">cleared</LPill>
                  </LTd>
                  <LTd numeric className="border-b-0 py-1.5">
                    <LButton
                      type="button"
                      size="sm"
                      variant="quiet"
                      disabled={pending}
                      onClick={() => statement.matchId && handleUnmatch(statement.matchId)}
                    >
                      Unmatch
                    </LButton>
                  </LTd>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LCard>
    </div>
  );
}
