"use client";

import { useMemo, useState } from "react";
import NextLink from "next/link";
import {
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Link as RadixLink,
  Select,
  Table,
  Text,
  TextField,
} from "@/components/ui";
import { formatCents, formatDate } from "@/lib/format";
import { parseCsv } from "@/lib/bank-import/csv";
import { applyCsvMapping, suggestColumnMapping } from "@/lib/bank-import/apply-mapping";
import { parseOfx } from "@/lib/bank-import/ofx";
import type { BankParseResult, ColumnMapping, CsvColumnKey } from "@/lib/bank-import/types";
import {
  confirmBankImport,
  createBankAccount,
  type BankAccountOption,
  type ConfirmBankImportResult,
} from "./actions";

const CSV_COLUMN_LABELS: Record<CsvColumnKey, string> = {
  posted_on: "Posted date",
  description: "Description",
  amount: "Amount (signed)",
  debit: "Debit / withdrawal",
  credit: "Credit / deposit",
  ignore: "Ignore",
};

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read that file."));
    reader.readAsText(file);
  });
}

export default function ImportWorkspace({ initialAccounts }: { initialAccounts: BankAccountOption[] }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? "");
  const selectedAccount = accounts.find((a) => a.id === bankAccountId) ?? null;

  // New-account mini form. Deliberately NOT a <form action={...}> dispatch
  // — a Radix Select's posted value only bubbles via its internal
  // defaultValue-based hidden input (see the house rule on React 19 +
  // Select), and this form is simple enough that building FormData by
  // hand from plain useState avoids that whole class of bug rather than
  // working around it.
  const [newAccountOpen, setNewAccountOpen] = useState(accounts.length === 0);
  const [newLabel, setNewLabel] = useState("");
  const [newKind, setNewKind] = useState<"checking" | "savings" | "credit_card">("checking");
  const [newLast4, setNewLast4] = useState("");
  const [newAccountPending, setNewAccountPending] = useState(false);
  const [newAccountError, setNewAccountError] = useState<string | null>(null);

  const handleCreateAccount = async () => {
    setNewAccountPending(true);
    setNewAccountError(null);
    const fd = new FormData();
    fd.set("label", newLabel);
    fd.set("kind", newKind);
    fd.set("last4", newLast4);
    const result = await createBankAccount(fd);
    setNewAccountPending(false);
    if (result.error || !result.account) {
      setNewAccountError(result.error ?? "Couldn't save that account.");
      return;
    }
    setAccounts((prev) => [...prev, result.account!].sort((a, b) => a.label.localeCompare(b.label)));
    setBankAccountId(result.account.id);
    setNewAccountOpen(false);
    setNewLabel("");
    setNewLast4("");
  };

  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<"csv" | "ofx" | "qfx" | null>(null);

  const [headerRow, setHeaderRow] = useState<string[]>([]);
  const [dataRecords, setDataRecords] = useState<{ fields: string[]; raw: string }[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>([]);

  const [parseResult, setParseResult] = useState<BankParseResult | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmBankImportResult | null>(null);

  const handleFile = async (file: File) => {
    setFileError(null);
    setParseResult(null);
    setConfirmResult(null);
    setConfirmError(null);
    setExcluded(new Set());
    setFileName(file.name);

    let text: string;
    try {
      text = await readFileAsText(file);
    } catch {
      setFileError("Couldn't read that file.");
      return;
    }
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".ofx") || lower.endsWith(".qfx")) {
      const fmt = lower.endsWith(".qfx") ? "qfx" : "ofx";
      setDetectedFormat(fmt);
      setHeaderRow([]);
      setDataRecords([]);
      if (selectedAccount) runOfx(text, fmt);
      return;
    }

    setDetectedFormat("csv");
    const parsed = parseCsv(text);
    if ("error" in parsed) {
      setFileError(parsed.error);
      return;
    }
    if (parsed.length === 0) {
      setFileError("That file has no rows.");
      return;
    }
    const [header, ...rest] = parsed;
    setHeaderRow(header!.fields);
    setDataRecords(rest);
    setMapping(suggestColumnMapping(header!.fields));
  };

  const runOfx = (text: string, fmt: "ofx" | "qfx") => {
    const result = parseOfx(text, fmt);
    setParseResult(result);
  };

  const runCsv = (signFlipOverride?: boolean) => {
    if (!selectedAccount) {
      setFileError("Pick which account this statement is from first.");
      return;
    }
    const result = applyCsvMapping({
      headerRow,
      dataRecords,
      mapping,
      accountKind: selectedAccount.kind,
      signFlipOverride,
    });
    setParseResult(result);
  };

  /**
   * Re-reads the statement with the amount column's direction reversed.
   *
   * Card issuers disagree about whether a purchase is written positive or
   * negative, and a short statement can easily hold more payments than
   * purchases — so the parser's reading is a SUGGESTION. On a file whose
   * own contents don't settle it (signInterpretation.decisive === false)
   * the pilot is asked outright, rather than having every amount silently
   * rewritten in whichever direction the row count happened to point.
   */
  const invertSignReading = () => {
    runCsv(!(parseResult?.signInterpretation?.flipped ?? false));
  };

  const setColumn = (idx: number, key: CsvColumnKey) => {
    setMapping((prev) => {
      const next = [...prev];
      next[idx] = key === "ignore" ? undefined : key;
      return next;
    });
  };

  const includedRows = useMemo(
    () => (parseResult ? parseResult.valid.filter((r) => !excluded.has(r.rowNumber)) : []),
    [parseResult, excluded]
  );

  const handleConfirm = async () => {
    if (!parseResult || !selectedAccount) return;
    setConfirming(true);
    setConfirmError(null);
    const result = await confirmBankImport({
      format: parseResult.format,
      bankAccountId: selectedAccount.id,
      fileName: fileName ?? "statement",
      totalRows: parseResult.valid.length + parseResult.rejected.length,
      rows: includedRows.map((r) => ({
        rowNumber: r.rowNumber,
        sourceRow: r.sourceRow,
        postedOn: r.postedOn,
        description: r.description,
        amountCents: r.amountCents,
      })),
      rejected: parseResult.rejected,
      excludedByPilot: excluded.size,
    });
    setConfirming(false);
    if (result.error) {
      setConfirmError(result.error);
      return;
    }
    setConfirmResult(result);
  };

  return (
    <Flex direction="column" gap="5">
      <Card size="3">
        <Flex direction="column" gap="3">
          <Text weight="medium">1. Which account is this from?</Text>
          <Flex gap="3" align="center" wrap="wrap">
            <Select.Root
              value={bankAccountId}
              onValueChange={(v) => {
                setBankAccountId(v);
                setParseResult(null);
              }}
            >
              <Select.Trigger placeholder="Pick an account" />
              <Select.Content>
                {accounts.map((a) => (
                  <Select.Item key={a.id} value={a.id}>
                    {a.label}
                    {a.last4 ? ` ···${a.last4}` : ""} — {KIND_LABEL[a.kind]}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Button type="button" variant="soft" onClick={() => setNewAccountOpen((v) => !v)}>
              {newAccountOpen ? "Cancel" : "Add an account"}
            </Button>
          </Flex>

          {newAccountOpen ? (
            <Card variant="surface">
              <Flex direction="column" gap="3">
                <Text size="2" color="gray">
                  A label only — never a full account number or any credential. Last 4 is optional, exactly as
                  printed on the statement.
                </Text>
                <Flex gap="3" wrap="wrap">
                  <TextField.Root
                    placeholder="e.g. Chase checking"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    style={{ minWidth: 220 }}
                  />
                  <Select.Root value={newKind} onValueChange={(v) => setNewKind(v as typeof newKind)}>
                    <Select.Trigger />
                    <Select.Content>
                      <Select.Item value="checking">Checking</Select.Item>
                      <Select.Item value="savings">Savings</Select.Item>
                      <Select.Item value="credit_card">Credit card</Select.Item>
                    </Select.Content>
                  </Select.Root>
                  <TextField.Root
                    placeholder="Last 4 (optional)"
                    value={newLast4}
                    onChange={(e) => setNewLast4(e.target.value)}
                    style={{ width: 140 }}
                  />
                </Flex>
                {newAccountError ? (
                  <Callout.Root>
                    <Callout.Text>{newAccountError}</Callout.Text>
                  </Callout.Root>
                ) : null}
                <Box>
                  <Button type="button" onClick={handleCreateAccount} disabled={newAccountPending}>
                    {newAccountPending ? "Saving…" : "Save account"}
                  </Button>
                </Box>
              </Flex>
            </Card>
          ) : null}
        </Flex>
      </Card>

      <Card size="3">
        <Flex direction="column" gap="3">
          <Text weight="medium">2. Upload a statement</Text>
          <Text size="2" color="gray">
            CSV, OFX, or QFX — whatever your bank's online portal lets you download. Nothing is written until you
            review and confirm below.
          </Text>
          <input
            type="file"
            accept=".csv,.ofx,.qfx,text/csv"
            disabled={!selectedAccount}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          {!selectedAccount ? (
            <Text size="2" color="gray">
              Pick or add an account above first.
            </Text>
          ) : null}
          {fileError ? (
            <Callout.Root>
              <Callout.Text>{fileError}</Callout.Text>
            </Callout.Root>
          ) : null}
        </Flex>
      </Card>

      {detectedFormat === "csv" && headerRow.length > 0 ? (
        <Card size="3">
          <Flex direction="column" gap="3">
            <Text weight="medium">3. Match your file's columns</Text>
            <Text size="2" color="gray">
              We guessed based on the header names — check them, especially Amount vs. Debit/Credit.
            </Text>
            <Table.Root variant="surface">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Column in your file</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Maps to</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {headerRow.map((h, idx) => (
                  <Table.Row key={idx}>
                    <Table.Cell>{h || `Column ${idx + 1}`}</Table.Cell>
                    <Table.Cell>
                      <Select.Root value={mapping[idx] ?? "ignore"} onValueChange={(v) => setColumn(idx, v as CsvColumnKey)}>
                        <Select.Trigger />
                        <Select.Content>
                          {(Object.keys(CSV_COLUMN_LABELS) as CsvColumnKey[]).map((k) => (
                            <Select.Item key={k} value={k}>
                              {CSV_COLUMN_LABELS[k]}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
            <Box>
              {/* Wrapped, not passed by reference: runCsv's first argument
                  is now the sign override, and React would hand it the
                  MouseEvent — which is truthy, so every parse would come
                  out inverted. tsc caught it; the wrapper is the fix. */}
              <Button type="button" onClick={() => runCsv()}>
                Parse {dataRecords.length} row{dataRecords.length === 1 ? "" : "s"}
              </Button>
            </Box>
          </Flex>
        </Card>
      ) : null}

      {parseResult ? (
        <Card size="3">
          <Flex direction="column" gap="3">
            <Text weight="medium">4. Review before anything is saved</Text>
            <Flex gap="4" wrap="wrap">
              <Text size="2" className="tnum">
                {parseResult.valid.length} parsed
              </Text>
              <Text size="2" color="red" className="tnum">
                {parseResult.rejected.length} rejected
              </Text>
              <Text size="2" className="tnum">
                {includedRows.length} will be imported
              </Text>
            </Flex>

            {/* WHICH WAY THE MONEY RUNS. Card issuers disagree about
                whether a purchase is written positive or negative, and
                getting it backwards inverts an entire statement: real
                purchases become "deposits" that can't be filed, and the
                month's one refund becomes the only expense. The parser
                reads the file's own convention and says what it concluded
                — plainly, with the counts it concluded it from — and the
                pilot can reverse it in one click. Amber when the file
                didn't settle the question, because then this is a
                question and not a note. */}
            {/* WRONG LEDGER. An OFX statement names the account it is for;
                the pilot picks one here. When those disagree, every row
                lands in the wrong ledger — and because the dedup index is
                scoped per bank account, importing the right statement
                afterwards does NOT collide, so the same charges get
                recorded twice. Compared on the last four digits, which is
                all the account picker shows and all a statement reliably
                carries. */}
            {parseResult.statementAccountId &&
            selectedAccount?.last4 &&
            parseResult.statementAccountId.slice(-4) !== selectedAccount.last4 ? (
              <Callout.Root color="amber" size="1">
                <Callout.Text>
                  This statement is for an account ending{" "}
                  ···{parseResult.statementAccountId.slice(-4)}, but you picked{" "}
                  {selectedAccount.label} ···{selectedAccount.last4}. Importing it
                  would file these transactions against the wrong account — and a
                  later import of the right statement wouldn&rsquo;t catch it as a
                  duplicate. Check the account above before continuing.
                </Callout.Text>
              </Callout.Root>
            ) : null}

            {parseResult.signInterpretation ? (
              <Callout.Root
                color={parseResult.signInterpretation.decisive ? "gray" : "amber"}
                size="1"
              >
                <Callout.Text>
                  We read {parseResult.signInterpretation.moneyOutRows} row
                  {parseResult.signInterpretation.moneyOutRows === 1 ? "" : "s"} as money
                  out and {parseResult.signInterpretation.moneyInRows} as money in
                  {parseResult.signInterpretation.selfDeclaredRows > 0
                    ? `, plus ${parseResult.signInterpretation.selfDeclaredRows} that said which way in the file itself`
                    : ""}
                  .{" "}
                  {parseResult.signInterpretation.decisive
                    ? "That matches this statement's own pattern."
                    : "This statement is too evenly split to be sure — check it against your card before importing."}{" "}
                  <RadixLink href="#" onClick={(e) => { e.preventDefault(); invertSignReading(); }}>
                    That&rsquo;s backwards — swap them
                  </RadixLink>
                  {parseResult.signInterpretation.overridden ? " (swapped)" : ""}
                </Callout.Text>
              </Callout.Root>
            ) : null}

            {parseResult.valid.length > 0 ? (
              <Box style={{ overflowX: "auto" }}>
                <Table.Root variant="surface">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Include</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Amount</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {parseResult.valid.slice(0, 500).map((row) => (
                      <Table.Row key={row.rowNumber}>
                        <Table.Cell>
                          <Checkbox
                            checked={!excluded.has(row.rowNumber)}
                            onCheckedChange={(checked) =>
                              setExcluded((prev) => {
                                const next = new Set(prev);
                                if (checked) next.delete(row.rowNumber);
                                else next.add(row.rowNumber);
                                return next;
                              })
                            }
                          />
                        </Table.Cell>
                        <Table.Cell className="tnum">{formatDate(row.postedOn)}</Table.Cell>
                        <Table.Cell>{row.description}</Table.Cell>
                        <Table.Cell className="tnum">
                          <Text color={row.amountCents < 0 ? "red" : "green"}>
                            {row.amountCents < 0 ? "−" : "+"}
                            {formatCents(Math.abs(row.amountCents))}
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
                {parseResult.valid.length > 500 ? (
                  <Text size="1" color="gray">
                    Showing the first 500 of {parseResult.valid.length} rows — every row is still included in the
                    import.
                  </Text>
                ) : null}
              </Box>
            ) : null}

            {parseResult.rejected.length > 0 ? (
              <Box>
                <Text size="2" weight="medium" color="red">
                  Rejected rows (not imported):
                </Text>
                <Table.Root variant="surface" mt="2">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Row</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Reason</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {parseResult.rejected.slice(0, 200).map((r) => (
                      <Table.Row key={r.rowNumber}>
                        <Table.Cell className="tnum">{r.rowNumber}</Table.Cell>
                        <Table.Cell>{r.reason}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Box>
            ) : null}

            {confirmError ? (
              <Callout.Root>
                <Callout.Text>{confirmError}</Callout.Text>
              </Callout.Root>
            ) : null}

            {confirmResult ? (
              <Callout.Root color={confirmResult.partial ? "amber" : "green"}>
                <Callout.Text>
                  {confirmResult.partial
                    ? confirmResult.partialMessage
                    : `Imported ${confirmResult.imported ?? 0}. ${
                        (confirmResult.duplicatesInLedger ?? 0) + (confirmResult.duplicatesInFile ?? 0)
                      } duplicate(s) skipped, ${confirmResult.rejectedCount ?? 0} rejected.`}{" "}
                  <RadixLink asChild>
                    <NextLink href="/expenses/transactions">Go review them →</NextLink>
                  </RadixLink>
                </Callout.Text>
              </Callout.Root>
            ) : (
              <Box>
                <Button type="button" onClick={handleConfirm} disabled={confirming || includedRows.length === 0}>
                  {confirming ? "Importing…" : `Import ${includedRows.length} transaction${includedRows.length === 1 ? "" : "s"}`}
                </Button>
              </Box>
            )}
          </Flex>
        </Card>
      ) : null}
    </Flex>
  );
}

const KIND_LABEL: Record<BankAccountOption["kind"], string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
};
