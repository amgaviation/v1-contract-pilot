"use client";

import { useMemo, useState } from "react";
import NextLink from "next/link";
import { LAlert, LButton, LCard, LTable, LTd, LTh } from "@/components/ledger";
import { LCheckbox, LInput, LSelect } from "@/components/ledger/forms";
import { formatCents, formatDate } from "@/lib/format";
import { parseCsv, type CsvRecord } from "@/lib/bank-import/csv";
import { applyCsvMapping, suggestColumnMapping } from "@/lib/bank-import/apply-mapping";
import { parseOfx } from "@/lib/bank-import/ofx";
import { parseStatementDate } from "@/lib/bank-import/date";
import { parseBankAmount } from "@/lib/bank-import/amount";
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
  // — built by hand from plain useState.
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
    // Routed through selectAccount (defined below), not setBankAccountId
    // directly — otherwise this path skips the OFX re-parse and can
    // leave a preview bound to a different ledger than the one shown.
    selectAccount(result.account.id);
    setNewAccountOpen(false);
    setNewLabel("");
    setNewLast4("");
  };

  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<"csv" | "ofx" | "qfx" | null>(null);

  // The CSV's records, unsplit — headerRow/dataRecords below are DERIVED
  // from this plus firstRowIsData, so toggling "first row is data, not
  // headers" (see the toggle's own comment) never needs to re-read the
  // file.
  const [csvRecords, setCsvRecords] = useState<CsvRecord[]>([]);
  // True when record 1 is a transaction, not column labels — several
  // major banks (Wells Fargo's checking/card CSV export is the canonical
  // example) export with no header row at all. Auto-guessed in handleFile,
  // and overridable via the checkbox in step 3.
  const [firstRowIsData, setFirstRowIsData] = useState(false);
  const headerRow = useMemo(
    () =>
      csvRecords.length === 0
        ? []
        : firstRowIsData
          ? csvRecords[0]!.fields.map((_, i) => `Column ${i + 1}`)
          : csvRecords[0]!.fields,
    [csvRecords, firstRowIsData]
  );
  const dataRecords = useMemo(
    () => (firstRowIsData ? csvRecords : csvRecords.slice(1)),
    [csvRecords, firstRowIsData]
  );
  const [mapping, setMapping] = useState<ColumnMapping>([]);

  // Held only for OFX/QFX. CSV survives an account switch because its
  // headerRow/dataRecords/mapping stay put and step 3 has a "Parse N rows"
  // button to redo the read; OFX has no such button (step 3 is CSV-only)
  // and parseOfx never looked at the account anyway, so re-running it from
  // this text is strictly better than losing the preview — see selectAccount
  // below.
  const [ofxText, setOfxText] = useState<string | null>(null);

  const [parseResult, setParseResult] = useState<BankParseResult | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmBankImportResult | null>(null);
  // Which account confirmResult belongs to. The success line below is
  // gated on this matching bankAccountId, so switching accounts hides
  // it without nulling confirmResult itself — confirmResult also carries
  // the in-file-duplicate list, the only place that list is ever shown.
  const [confirmResultAccountId, setConfirmResultAccountId] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setFileError(null);
    setParseResult(null);
    setConfirmResult(null);
    setConfirmResultAccountId(null);
    setConfirmError(null);
    setExcluded(new Set());
    setFileName(file.name);
    // Cleared here, unconditionally, before the read is even attempted —
    // not just on the success paths below. Otherwise a failed read on a
    // SECOND file (moved, permissions, IO error) would leave the FIRST
    // file's ofxText/detectedFormat in place under the second file's name,
    // and an account switch afterwards would resurrect that stale text as
    // if it were a preview of the file currently attached.
    setDetectedFormat(null);
    setOfxText(null);

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
      setCsvRecords([]);
      setFirstRowIsData(false);
      setOfxText(text);
      if (selectedAccount) runOfx(text, fmt);
      return;
    }

    setDetectedFormat("csv");
    setOfxText(null);
    const parsed = parseCsv(text);
    if ("error" in parsed) {
      setFileError(parsed.error);
      return;
    }
    if (parsed.length === 0) {
      setFileError("That file has no rows.");
      return;
    }
    setCsvRecords(parsed);

    // AUTO-DETECT A HEADERLESS FILE (fixed after review). Several major
    // banks (Wells Fargo's checking/card CSV export is the canonical
    // example) export with NO header row — record 1 is already a
    // transaction. Unconditionally treating it as headers silently ate
    // that transaction: its values became the column LABELS in step 3,
    // "Parse N rows" reported one fewer row than the file actually holds,
    // and nothing said so.
    //
    // suggestColumnMapping already returns an all-undefined mapping when a
    // row's cells don't match any known header name — that alone isn't
    // proof (a bank really might use unfamiliar header text), but combined
    // with the first cell parsing as a calendar date AND some other cell
    // parsing as a bank amount, the row is doing what a TRANSACTION does,
    // not what a header does. The checkbox in step 3 overrides this either
    // way.
    const first = parsed[0]!.fields;
    const headerGuess = suggestColumnMapping(first);
    const looksHeaderless =
      headerGuess.every((m) => m === undefined) &&
      first.some((cell) => parseStatementDate(cell.trim()) !== null) &&
      first.some((cell) => parseBankAmount(cell.trim()) !== undefined);
    setFirstRowIsData(looksHeaderless);
    setMapping(
      looksHeaderless
        ? suggestColumnMapping(first.map((_, i) => `Column ${i + 1}`))
        : headerGuess
    );
  };

  const runOfx = (text: string, fmt: "ofx" | "qfx") => {
    const result = parseOfx(text, fmt);
    setParseResult(result);
  };

  // Both the Select below and "Save account" above call this — neither
  // may change the selected account any other way, or a preview can end
  // up bound to a different ledger than the one showing (handleCreateAccount
  // used to call setBankAccountId directly and skip all of it).
  //
  // OFX/QFX has no re-parse button (step 3 below is CSV-only) and
  // re-picking the identical file doesn't reliably re-fire <input
  // type="file">'s change event in Chrome/Safari, so the stored ofxText
  // is re-run through parseOfx (which never reads the account) instead
  // of losing the preview. CSV keeps headerRow/dataRecords untouched;
  // step 3's "Parse N rows" button redoes that read.
  const selectAccount = (id: string) => {
    setBankAccountId(id);
    setConfirmError(null);
    if ((detectedFormat === "ofx" || detectedFormat === "qfx") && ofxText) {
      runOfx(ofxText, detectedFormat);
    } else {
      setParseResult(null);
    }
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

  /**
   * The pilot's own answer to "is that first row a transaction or column
   * labels?" — overrides handleFile's guess either way. Column count never
   * changes, only what fills row 1, so the mapping is re-suggested against
   * whichever text now stands in for headers (real header names when
   * unchecked, generic "Column N" labels — which suggestColumnMapping
   * cannot match to anything — when checked, forcing an explicit pick per
   * column exactly as a headerless file requires).
   */
  const toggleFirstRowIsData = (value: boolean) => {
    setFirstRowIsData(value);
    if (csvRecords.length === 0) return;
    const fields = csvRecords[0]!.fields;
    setMapping(
      suggestColumnMapping(value ? fields.map((_, i) => `Column ${i + 1}`) : fields)
    );
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
    setConfirmResultAccountId(selectedAccount.id);
  };

  return (
    <div className="flex flex-col gap-5">
      <LCard>
        <div className="flex flex-col gap-3">
          <p className="font-medium text-ink">1. Which account is this from?</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-56">
              <LSelect value={bankAccountId} onChange={(e) => selectAccount(e.target.value)}>
                {bankAccountId === "" ? (
                  <option value="" disabled>
                    Pick an account
                  </option>
                ) : null}
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                    {a.last4 ? ` ···${a.last4}` : ""}, {KIND_LABEL[a.kind]}
                  </option>
                ))}
              </LSelect>
            </div>
            <LButton type="button" variant="outline" onClick={() => setNewAccountOpen((v) => !v)}>
              {newAccountOpen ? "Cancel" : "Add an account"}
            </LButton>
          </div>

          {newAccountOpen ? (
            <div className="rounded-card border border-hair bg-sunk p-4">
              <div className="flex flex-col gap-3">
                <p className="text-body-s text-ink-2">
                  A label only, never a full account number or any credential. Last 4 is optional, exactly as
                  printed on the statement.
                </p>
                <div className="flex flex-wrap gap-3">
                  <LInput
                    placeholder="e.g. Chase checking"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    className="min-w-56"
                  />
                  <div className="w-44">
                    <LSelect
                      value={newKind}
                      onChange={(e) => setNewKind(e.target.value as typeof newKind)}
                    >
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                      <option value="credit_card">Credit card</option>
                    </LSelect>
                  </div>
                  <LInput
                    placeholder="Last 4 (optional)"
                    value={newLast4}
                    onChange={(e) => setNewLast4(e.target.value)}
                    className="w-36"
                  />
                </div>
                {newAccountError ? <LAlert tone="crit">{newAccountError}</LAlert> : null}
                <div>
                  <LButton type="button" onClick={handleCreateAccount} disabled={newAccountPending}>
                    {newAccountPending ? "Saving…" : "Save account"}
                  </LButton>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </LCard>

      <LCard>
        <div className="flex flex-col gap-3">
          <p className="font-medium text-ink">2. Upload a statement</p>
          <p className="text-body-s text-ink-2">
            CSV, OFX, or QFX: whatever your bank's online portal lets you download. Nothing is written until you
            review and confirm below.
          </p>
          <input
            type="file"
            accept=".csv,.ofx,.qfx,text/csv"
            disabled={!selectedAccount}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="text-body-s text-ink"
          />
          {!selectedAccount ? (
            <p className="text-body-s text-ink-2">Pick or add an account above first.</p>
          ) : null}
          {fileError ? <LAlert tone="crit">{fileError}</LAlert> : null}
        </div>
      </LCard>

      {detectedFormat === "csv" && headerRow.length > 0 ? (
        <LCard>
          <div className="flex flex-col gap-3">
            <p className="font-medium text-ink">3. Match your file's columns</p>
            <p className="text-body-s text-ink-2">
              We guessed based on the header names. Check them, especially Amount vs. Debit/Credit.
            </p>
            <label className="flex items-center gap-2 text-body-s text-ink">
              <LCheckbox
                checked={firstRowIsData}
                onChange={(e) => toggleFirstRowIsData(e.target.checked)}
              />
              The first row above is a transaction, not column headers. Some
              banks (Wells Fargo among them) export CSVs with no header row at all.
            </label>
            {firstRowIsData ? (
              <LAlert tone="warn">
                Every row below, including the first, is treated as a
                transaction. There&rsquo;s no header text to guess column names
                from, so map each one by hand.
              </LAlert>
            ) : null}
            <LTable>
              <thead>
                <tr>
                  <LTh>Column in your file</LTh>
                  <LTh>Maps to</LTh>
                </tr>
              </thead>
              <tbody>
                {headerRow.map((h, idx) => (
                  <tr key={idx}>
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                    >
                      {h || `Column ${idx + 1}`}
                    </th>
                    <LTd>
                      <div className="w-56">
                        <LSelect
                          value={mapping[idx] ?? "ignore"}
                          onChange={(e) => setColumn(idx, e.target.value as CsvColumnKey)}
                        >
                          {(Object.keys(CSV_COLUMN_LABELS) as CsvColumnKey[]).map((k) => (
                            <option key={k} value={k}>
                              {CSV_COLUMN_LABELS[k]}
                            </option>
                          ))}
                        </LSelect>
                      </div>
                    </LTd>
                  </tr>
                ))}
              </tbody>
            </LTable>
            <div>
              {/* Wrapped, not passed by reference: runCsv's first argument
                  is now the sign override, and React would hand it the
                  MouseEvent — which is truthy, so every parse would come
                  out inverted. tsc caught it; the wrapper is the fix. */}
              <LButton type="button" onClick={() => runCsv()}>
                Parse {dataRecords.length} row{dataRecords.length === 1 ? "" : "s"}
              </LButton>
            </div>
          </div>
        </LCard>
      ) : null}

      {parseResult ? (
        <LCard>
          <div className="flex flex-col gap-3">
            <p className="font-medium text-ink">4. Review before anything is saved</p>
            <div className="flex flex-wrap gap-4">
              <span className="tnum-l text-body-s text-ink-2">{parseResult.valid.length} parsed</span>
              <span className="tnum-l text-body-s text-crit">{parseResult.rejected.length} rejected</span>
              <span className="tnum-l text-body-s text-ink-2">{includedRows.length} will be imported</span>
            </div>

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
                carries.

                last4 is optional on a saved account (step 1's "Last 4
                (optional)" field), so the comparison can't always be run.
                An absent last4 is NOT a match — it's an unknown — and the
                guard has to say so rather than fall through silently: this
                preview now survives an account switch (see the Select's
                onChange above), so a bare account with no last4 would
                otherwise be a clean, warning-free path to filing statement
                A into account B. */}
            {parseResult.statementAccountId && selectedAccount?.last4 ? (
              parseResult.statementAccountId.slice(-4) !== selectedAccount.last4 ? (
                <LAlert tone="warn">
                  This statement is for an account ending{" "}
                  ···{parseResult.statementAccountId.slice(-4)}, but you picked{" "}
                  {selectedAccount.label} ···{selectedAccount.last4}. Importing it
                  would file these transactions against the wrong account, and a
                  later import of the right statement wouldn&rsquo;t catch it as a
                  duplicate. Check the account above before continuing.
                </LAlert>
              ) : null
            ) : parseResult.statementAccountId && selectedAccount && !selectedAccount.last4 ? (
              <LAlert tone="warn">
                This statement is for an account ending{" "}
                ···{parseResult.statementAccountId.slice(-4)}, but{" "}
                {selectedAccount.label} has no last 4 on file, so we can&rsquo;t
                confirm it&rsquo;s the same account. Double-check the statement
                yourself before importing. A later import of the right
                statement wouldn&rsquo;t catch a mismatch as a duplicate.
              </LAlert>
            ) : null}

            {parseResult.signInterpretation ? (
              <LAlert tone={parseResult.signInterpretation.decisive ? "neutral" : "warn"}>
                We read {parseResult.signInterpretation.moneyOutRows} row
                {parseResult.signInterpretation.moneyOutRows === 1 ? "" : "s"} as money
                out and {parseResult.signInterpretation.moneyInRows} as money in
                {parseResult.signInterpretation.selfDeclaredRows > 0
                  ? `, plus ${parseResult.signInterpretation.selfDeclaredRows} that said which way in the file itself`
                  : ""}
                .{" "}
                {parseResult.signInterpretation.decisive
                  ? "That matches this statement's own pattern."
                  : "This statement is too evenly split to be sure. Check it against your card before importing."}{" "}
                <button
                  type="button"
                  className="font-medium text-accent underline-offset-2 hover:underline"
                  onClick={() => invertSignReading()}
                >
                  That&rsquo;s backwards; swap them
                </button>
                {parseResult.signInterpretation.overridden ? " (swapped)" : ""}
              </LAlert>
            ) : null}

            {parseResult.valid.length > 0 ? (
              <div>
                <LTable>
                  <thead>
                    <tr>
                      <LTh>Include</LTh>
                      <LTh>Date</LTh>
                      <LTh>Description</LTh>
                      <LTh numeric>Amount</LTh>
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.valid.slice(0, 500).map((row) => (
                      <tr key={row.rowNumber}>
                        <th
                          scope="row"
                          className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                        >
                          <LCheckbox
                            checked={!excluded.has(row.rowNumber)}
                            onChange={(e) =>
                              setExcluded((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.delete(row.rowNumber);
                                else next.add(row.rowNumber);
                                return next;
                              })
                            }
                          />
                        </th>
                        <LTd>
                          <span className="tnum-l">{formatDate(row.postedOn)}</span>
                        </LTd>
                        <LTd>{row.description}</LTd>
                        <LTd numeric>
                          <span className={row.amountCents < 0 ? "text-crit" : "text-good"}>
                            {row.amountCents < 0 ? "−" : "+"}
                            {formatCents(Math.abs(row.amountCents))}
                          </span>
                        </LTd>
                      </tr>
                    ))}
                  </tbody>
                </LTable>
                {parseResult.valid.length > 500 ? (
                  <p className="text-caption text-ink-3">
                    Showing the first 500 of {parseResult.valid.length} rows. Every row is still included in the
                    import.
                  </p>
                ) : null}
              </div>
            ) : null}

            {parseResult.rejected.length > 0 ? (
              <div>
                <p className="font-medium text-crit">Rejected rows (not imported):</p>
                <div className="mt-2">
                  <LTable>
                    <thead>
                      <tr>
                        <LTh>Row</LTh>
                        <LTh>Reason</LTh>
                      </tr>
                    </thead>
                    <tbody>
                      {parseResult.rejected.slice(0, 200).map((r) => (
                        <tr key={r.rowNumber}>
                          <th
                            scope="row"
                            className="tnum-l border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                          >
                            {r.rowNumber}
                          </th>
                          <LTd>{r.reason}</LTd>
                        </tr>
                      ))}
                    </tbody>
                  </LTable>
                </div>
              </div>
            ) : null}

            {confirmError ? <LAlert tone="crit">{confirmError}</LAlert> : null}

            {confirmResult && confirmResultAccountId === bankAccountId ? (
              <LAlert tone={confirmResult.partial ? "warn" : "good"}>
                {/* THE TWO KINDS OF DUPLICATE ARE NOT THE SAME EVENT and
                    were being summed into one number.

                    An IN-LEDGER duplicate is the feature working: an
                    overlapping re-import found a transaction already
                    imported, and skipping it is exactly right.

                    An IN-FILE duplicate is a transaction the statement
                    itself listed twice as far as the fingerprint can
                    tell — two $4.75 coffees, a toll charged both ways —
                    and one of them was DROPPED. That is a probable real
                    transaction the pilot now has to notice is missing.
                    fingerprint.ts documents the collision and justifies
                    it by saying the loss is "recoverable: the pilot adds
                    the missed transaction as a manual expense" — which
                    requires telling them, and one combined count in a
                    routine-looking total does not. */}
                {confirmResult.partial
                  ? confirmResult.partialMessage
                  : `Imported ${confirmResult.imported ?? 0}. ${
                      confirmResult.duplicatesInLedger ?? 0
                    } already imported before, ${confirmResult.rejectedCount ?? 0} rejected.`}{" "}
                <NextLink href="/expenses/transactions" className="font-medium text-accent underline-offset-2 hover:underline">
                  Go review them →
                </NextLink>
              </LAlert>
            ) : null}

            {/* The in-file collisions, called out separately and by row,
                because each one is a transaction that did NOT make it in
                and that the pilot has to decide about. duplicateDetail was
                already being computed, persisted to the batch AND returned
                — and then dropped on the floor here. bank_import_batches
                is never selected anywhere, so it was unreachable forever. */}
            {confirmResult &&
            confirmResultAccountId === bankAccountId &&
            !confirmResult.partial &&
            (confirmResult.duplicatesInFile ?? 0) > 0 ? (
              <LAlert tone="warn">
                <p className="mb-1 font-medium">
                  {confirmResult.duplicatesInFile} transaction
                  {confirmResult.duplicatesInFile === 1 ? " was" : "s were"} skipped as a
                  repeat of another row in the same file.
                </p>
                <p className="mb-1 text-caption">
                  Two charges on the same day, at the same place, for the same
                  amount look identical to us, so if these are genuinely
                  separate (two crew meals, a toll paid both ways), add the
                  missing one as an expense by hand.
                </p>
                {(confirmResult.duplicateDetail ?? [])
                  .filter((d) => d.kind === "in_file")
                  .slice(0, 10)
                  .map((d) => (
                    <p className="text-caption" key={`dup-${d.rowNumber}`}>
                      Row {d.rowNumber}
                      {d.sourceRow ? `, ${Object.values(d.sourceRow).slice(0, 3).join(" · ")}` : ""}
                    </p>
                  ))}
              </LAlert>
            ) : null}

            {/* CROSS-FORMAT REMATCH. Same statement range imported once as
                CSV and later as OFX/QFX (or the reverse) hashes to a
                DIFFERENT fingerprint — OFX builds "NAME: MEMO" where a CSV
                export carries the bank's own single description column —
                so the exact-match dedup above lets it straight through with
                no warning. These rows WERE imported (unlike the in-file
                skip above, nothing was dropped); this only flags that an
                existing transaction on this account already matches the
                same amount within a few days, in case it's the same charge
                under different text. */}
            {confirmResult &&
            confirmResultAccountId === bankAccountId &&
            !confirmResult.partial &&
            (confirmResult.possibleRematches?.length ?? 0) > 0 ? (
              <LAlert tone="warn">
                <p className="mb-1 font-medium">
                  {confirmResult.possibleRematches!.length} imported transaction
                  {confirmResult.possibleRematches!.length === 1 ? "" : "s"} match
                  {confirmResult.possibleRematches!.length === 1 ? "es" : ""} an amount already on
                  file for this account within a few days, under different text.
                </p>
                <p className="mb-1 text-caption">
                  A likely cause is re-importing the same statement range in a
                  different format (CSV, then later OFX/QFX). The file&rsquo;s
                  wording differs enough that we can&rsquo;t tell it&rsquo;s the same
                  charge automatically. Check the review queue for a real
                  duplicate before confirming either one as an expense.
                </p>
                {confirmResult.possibleRematches!.slice(0, 10).map((r) => (
                  <p className="text-caption" key={`rematch-${r.rowNumber}`}>
                    Row {r.rowNumber}
                    {r.sourceRow ? `, ${Object.values(r.sourceRow).slice(0, 3).join(" · ")}` : ""}
                  </p>
                ))}
                {confirmResult.possibleRematches!.length > 10 ? (
                  <p className="mt-1 text-caption">
                    Showing the first 10 of {confirmResult.possibleRematches!.length}.
                  </p>
                ) : null}
              </LAlert>
            ) : null}

            {!confirmResult || confirmResultAccountId !== bankAccountId ? (
              <div>
                <LButton type="button" onClick={handleConfirm} disabled={confirming || includedRows.length === 0}>
                  {confirming ? "Importing…" : `Import ${includedRows.length} transaction${includedRows.length === 1 ? "" : "s"}`}
                </LButton>
              </div>
            ) : null}
          </div>
        </LCard>
      ) : null}
    </div>
  );
}

const KIND_LABEL: Record<BankAccountOption["kind"], string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
};
