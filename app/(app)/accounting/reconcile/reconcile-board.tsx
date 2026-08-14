"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  Flex,
  Grid,
  Table,
  Text,
} from "@/components/ui";
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
    <Flex direction="column" gap="4">
      <Flex gap="3" align="center" wrap="wrap">
        <Button
          type="button"
          disabled={pending || !txn || !line || !amountsAgree}
          onClick={handleMatch}
        >
          {pending ? "Working…" : "Match selected pair"}
        </Button>
        {txn && line && !amountsAgree ? (
          <Text size="1" color="amber">
            Amounts must be identical to match ({formatCents(txn.amountCents)} vs{" "}
            {formatCents(line.signedCents)}).
          </Text>
        ) : (
          <Text size="1" color="gray">
            Select one line in each column, then match. Money in is positive,
            money out negative. Both sides use the same sign.
          </Text>
        )}
      </Flex>
      {error ? (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      ) : null}

      <Grid columns={{ initial: "1", md: "2" }} gap="4">
        <Card size="2">
          <Text as="div" size="2" weight="bold" mb="2">
            Statement lines ({unmatchedStatement.length} unmatched)
          </Text>
          {unmatchedStatement.length === 0 ? (
            <Text size="2" color="gray">
              Every statement line in this period is matched.
            </Text>
          ) : (
            <Table.Root variant="ghost" size="1">
              <Table.Body>
                {unmatchedStatement.map((l) => (
                  <Table.Row key={l.id}>
                    <Table.Cell>
                      <label>
                        <Flex gap="2" align="center">
                          <input
                            type="radio"
                            name="statement-line"
                            checked={selectedTxn === l.id}
                            onChange={() => setSelectedTxn(l.id)}
                            aria-label={`${formatDate(l.postedOn)} ${l.description} ${formatCents(l.amountCents)}`}
                          />
                          <Text size="1" color="gray">
                            {formatDate(l.postedOn)}
                          </Text>
                          <Text size="1">{l.description}</Text>
                          <Text size="1" color="gray">
                            · {l.source}
                          </Text>
                        </Flex>
                      </label>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text size="1" className="tnum" color={l.amountCents < 0 ? "red" : "green"}>
                        {formatCents(l.amountCents)}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Card>

        <Card size="2">
          <Text as="div" size="2" weight="bold" mb="2">
            Ledger Cash &amp; bank lines ({unmatchedLedger.length} unmatched)
          </Text>
          {unmatchedLedger.length === 0 ? (
            <Text size="2" color="gray">
              Every ledger cash line in this period is matched.
            </Text>
          ) : (
            <Table.Root variant="ghost" size="1">
              <Table.Body>
                {unmatchedLedger.map((l) => (
                  <Table.Row key={l.journalLineId}>
                    <Table.Cell>
                      <label>
                        <Flex gap="2" align="center">
                          <input
                            type="radio"
                            name="ledger-line"
                            checked={selectedLine === l.journalLineId}
                            onChange={() => setSelectedLine(l.journalLineId)}
                            aria-label={`${formatDate(l.entryDate)} ${l.memo} ${formatCents(l.signedCents)}`}
                          />
                          <Text size="1" color="gray">
                            {formatDate(l.entryDate)}
                          </Text>
                          <Text size="1">{l.memo}</Text>
                        </Flex>
                      </label>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text size="1" className="tnum" color={l.signedCents < 0 ? "red" : "green"}>
                        {formatCents(l.signedCents)}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Card>
      </Grid>

      <Card size="2">
        <Text as="div" size="2" weight="bold" mb="2">
          Matched ({matchedPairs.length})
        </Text>
        {matchedPairs.length === 0 ? (
          <Text size="2" color="gray">
            Nothing matched in this period yet.
          </Text>
        ) : (
          <Table.Root variant="ghost" size="1">
            <Table.Body>
              {matchedPairs.map(({ statement, ledger }) => (
                <Table.Row key={statement.id}>
                  <Table.Cell>
                    <Text size="1">
                      {formatDate(statement.postedOn)}: {statement.description}
                    </Text>
                    <Text size="1" color="gray">
                      {" "}
                      · {statement.source}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="1" color="gray">
                      {ledger ? ledger.memo : "(ledger line outside this period)"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Text size="1" className="tnum">
                      {formatCents(statement.amountCents)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Badge color="green" variant="soft">
                      cleared
                    </Badge>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Button
                      type="button"
                      size="1"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => statement.matchId && handleUnmatch(statement.matchId)}
                    >
                      Unmatch
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card>
    </Flex>
  );
}
