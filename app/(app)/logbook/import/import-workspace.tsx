"use client";

import { useId, useMemo, useState, useTransition } from "react";
import NextLink from "next/link";
import { LAlert, LButton, LCard, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LCheckbox, LSelect } from "@/components/ledger/forms";
import { LTabsRoot, LTabsList, LTabsTrigger } from "@/components/ledger/tabs";

import { parseForeflight } from "@/lib/logbook-import/foreflight";
import { parseLogTen } from "@/lib/logbook-import/logten";
import { parseGenericHeader, suggestMapping, applyGenericMapping, MAPPABLE_FIELDS } from "@/lib/logbook-import/generic";
import { resolveRow, isWhollySimulator } from "@/lib/logbook-import/resolve-row";
import type { CsvRecord } from "@/lib/logbook-import/csv";
import type { ColumnMapping, ImportFormat, ParseResult, ParsedRow } from "@/lib/logbook-import/types";
import type { LogbookRole, SimulatorDeviceType } from "../db";
import {
  confirmImport,
  type ConfirmImportResult,
  type ConfirmImportRow,
  type DuplicateRowDetail,
} from "./actions";

const NONE = "__none__";
const PREVIEW_ROW_LIMIT = 200;
const REJECTED_ROW_LIMIT = 200;
const DUPLICATE_ROW_LIMIT = 200;
/**
 * Client-side estimate of the confirmImport POST body, checked BEFORE the
 * request is sent. actions.ts's MAX_ROWS_PER_CONFIRM comment has the
 * measured numbers this is sized against: 5,000 rows stays comfortably
 * under the 10 MB next.config.ts bodySizeLimit on realistic remarks, but
 * a file with unusually long remarks can still blow the budget well
 * under that row count (measured: 5,000 rows x 500-char remarks = 10.73
 * MB) — the row cap alone can't catch that case, only an actual size
 * estimate can. 8,000,000 bytes leaves ~2 MB of headroom under the 10 MB
 * limit for the Server Actions envelope / HTTP framing this estimate
 * doesn't account for. Catching it here means the pilot gets this app's
 * own specific message instead of an opaque Next.js framework error.
 */
const ESTIMATED_PAYLOAD_BYTE_LIMIT = 8_000_000;

const ROLE_OPTIONS: { value: LogbookRole; label: string }[] = [
  { value: "PIC", label: "PIC" },
  { value: "SIC", label: "SIC" },
  { value: "SOLO", label: "Solo" },
  { value: "DUAL_RECEIVED", label: "Dual received" },
];
const DEVICE_OPTIONS: { value: SimulatorDeviceType; label: string }[] = [
  { value: "ffs", label: "Full flight simulator (FFS)" },
  { value: "ftd", label: "FTD" },
  { value: "atd", label: "ATD" },
  { value: "other", label: "Other" },
];

type RowState = {
  included: boolean;
  role: LogbookRole | null;
  simulatorDeviceType: SimulatorDeviceType | null;
};

type Stage =
  | { kind: "pick" }
  | { kind: "map-generic"; fileName: string; header: string[]; dataRecords: CsvRecord[]; mapping: ColumnMapping }
  | { kind: "preview"; fileName: string; result: ParseResult }
  | { kind: "done"; fileName: string; result: ParseResult; outcome: ConfirmImportResult };

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read that file."));
    reader.readAsText(file);
  });
}

export default function ImportWorkspace() {
  const [format, setFormat] = useState<ImportFormat>("foreflight");
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const [parseError, setParseError] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Map<number, RowState>>(new Map());
  const [pending, startTransition] = useTransition();
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const fileInputId = useId();

  function resetToPick() {
    setStage({ kind: "pick" });
    setParseError(null);
    setRowStates(new Map());
    setConfirmError(null);
  }

  function stateFor(row: ParsedRow): RowState {
    return (
      rowStates.get(row.rowNumber) ?? {
        included: true,
        role: row.roleSource === "needs_selection" ? null : row.values.role,
        simulatorDeviceType: row.needsSimulatorDeviceType ? null : row.values.simulator_device_type,
      }
    );
  }

  function updateRow(rowNumber: number, patch: Partial<RowState>, row: ParsedRow) {
    setRowStates((prev) => {
      const next = new Map(prev);
      next.set(rowNumber, { ...stateFor(row), ...patch });
      return next;
    });
  }

  async function handleFile(file: File) {
    setParseError(null);
    setConfirmError(null);
    let text: string;
    try {
      text = await readFileAsText(file);
    } catch {
      setParseError("Couldn't read that file.");
      return;
    }

    if (format === "foreflight") {
      const result = parseForeflight(text);
      if ("error" in result) {
        setParseError(result.error);
        return;
      }
      setRowStates(new Map());
      setStage({ kind: "preview", fileName: file.name, result });
      return;
    }
    if (format === "logten") {
      const result = parseLogTen(text);
      if ("error" in result) {
        setParseError(result.error);
        return;
      }
      setRowStates(new Map());
      setStage({ kind: "preview", fileName: file.name, result });
      return;
    }

    // Generic — a header + mapping step comes first, never straight to preview.
    const headerResult = parseGenericHeader(text);
    if ("error" in headerResult) {
      setParseError(headerResult.error);
      return;
    }
    setStage({
      kind: "map-generic",
      fileName: file.name,
      header: headerResult.header,
      dataRecords: headerResult.dataRecords,
      mapping: suggestMapping(headerResult.header),
    });
  }

  function applyGenericStage() {
    if (stage.kind !== "map-generic") return;
    if (!stage.mapping.includes("entry_date") || !stage.mapping.includes("total_time")) {
      setParseError("Map at least Date and Total time before continuing.");
      return;
    }
    const result = applyGenericMapping(stage.header, stage.dataRecords, stage.mapping);
    setParseError(null);
    setRowStates(new Map());
    setStage({ kind: "preview", fileName: stage.fileName, result });
  }

  const preview = stage.kind === "preview" || stage.kind === "done" ? stage : null;

  const summary = useMemo(() => {
    if (!preview) return null;
    let needsRole = 0;
    let needsDevice = 0;
    let includedCount = 0;
    // Rows that are checked, have a resolvable role, AND (if simulator
    // time applies) a resolved device type — i.e. rows that will actually
    // be SENT on the next confirm. Distinct from includedCount: a row can
    // be "included" (checked) but still held back this time because its
    // role is unresolved (see handleConfirm) — the button label below
    // must say what will actually happen, not just what's checked.
    let willImportCount = 0;
    for (const row of preview.result.valid) {
      const s = stateFor(row);
      if (!s.included) continue;
      includedCount += 1;
      // A WHOLLY-SIMULATOR row needs no role and must not be counted as
      // needing one. Getting this wrong made the entire roleless-simulator
      // path unreachable: for a file of nothing but sim sessions
      // willImportCount stayed 0, canConfirm requires it to be positive,
      // and the Import button stayed disabled — the rows resolved
      // perfectly and could never be sent. Caught in review. This counter
      // and resolveRow have to agree on what "resolvable" means, so both
      // now ask isWhollySimulator rather than each deciding for itself.
      const roleOptional = isWhollySimulator(row.values);
      if (!s.role && !roleOptional) needsRole += 1;
      if (row.needsSimulatorDeviceType && !s.simulatorDeviceType) needsDevice += 1;
      const deviceOk = !row.needsSimulatorDeviceType || !!s.simulatorDeviceType;
      if ((s.role || roleOptional) && deviceOk) willImportCount += 1;
    }
    return { needsRole, needsDevice, includedCount, willImportCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, rowStates]);

  function applyDefaultRoleToUndecided(role: LogbookRole) {
    if (!preview) return;
    setRowStates((prev) => {
      const next = new Map(prev);
      for (const row of preview.result.valid) {
        const s = stateFor(row);
        if (!s.role) next.set(row.rowNumber, { ...s, role });
      }
      return next;
    });
  }

  function applyDefaultDeviceToUndecided(device: SimulatorDeviceType) {
    if (!preview) return;
    setRowStates((prev) => {
      const next = new Map(prev);
      for (const row of preview.result.valid) {
        if (!row.needsSimulatorDeviceType) continue;
        const s = stateFor(row);
        if (!s.simulatorDeviceType) next.set(row.rowNumber, { ...s, simulatorDeviceType: device });
      }
      return next;
    });
  }

  function handleConfirm() {
    if (!preview || preview.kind !== "preview") return;
    const result = preview.result;

    const rows: ConfirmImportRow[] = [];
    let excludedByPilot = 0;
    let heldForRole = 0;
    for (const row of result.valid) {
      const s = stateFor(row);
      if (!s.included) {
        excludedByPilot += 1;
        continue;
      }
      const resolved = resolveRow(row.values, {
        role: s.role,
        simulatorDeviceType: s.simulatorDeviceType,
      });
      if (!resolved) {
        // A source like ForeFlight has no role column at all — PIC, SIC,
        // Solo, and DualReceived are independent TIME fields that can
        // overlap on the same row (see the role-vocabulary migration's
        // precedence rule for how apply-mapping.ts resolves the common
        // cases automatically). pilot.logbook_entries.role now covers all
        // four (PIC/SIC/SOLO/DUAL_RECEIVED), so this branch is reached
        // only when a row's times give NO usable signal at all (e.g. every
        // relevant time column is zero/blank) or a mapped role column had
        // an unrecognized value — forcing a guess here would still be
        // writing a false assertion into a legal record. So: a row whose
        // role genuinely can't be determined from the file (and the pilot
        // hasn't picked one in the table above) is held back from THIS
        // confirm rather than blocking every other row in the batch —
        // "let ForeFlight imports just import." The pilot resolves it
        // later, either by picking a role in this table and re-including
        // it, or by adding it by hand.
        heldForRole += 1;
        continue;
      }
      rows.push({ rowNumber: row.rowNumber, sourceRow: row.sourceRow, values: resolved });
    }

    if (rows.length === 0) {
      setConfirmError(
        heldForRole > 0
          ? "Every included row needs a role (PIC/SIC) chosen before it can be imported. Pick one per row, or use the default buttons above."
          : "No rows are selected to import."
      );
      return;
    }

    // Estimate the POST body size BEFORE sending it — see
    // ESTIMATED_PAYLOAD_BYTE_LIMIT's comment. This is the same shape
    // confirmImport's payload argument actually has (rows + rejected +
    // the small fixed fields), so stringifying it here is a faithful
    // proxy for what fetch will actually send.
    const estimatedPayload = { format: result.format, fileName: preview.fileName, rows, rejected: result.rejected };
    const estimatedBytes = new TextEncoder().encode(JSON.stringify(estimatedPayload)).length;
    if (estimatedBytes > ESTIMATED_PAYLOAD_BYTE_LIMIT) {
      setConfirmError(
        `This import is too large to send in one request (about ${(estimatedBytes / 1_000_000).toFixed(1)} MB). Split the file into smaller pieces and import them separately, or shorten long remarks, then try again.`
      );
      return;
    }

    setConfirmError(null);
    startTransition(async () => {
      const outcome = await confirmImport({
        format: result.format,
        fileName: preview.fileName,
        totalRows: result.valid.length + result.rejected.length,
        rows,
        rejected: result.rejected,
        // Rows unchecked by the pilot and rows held back for an
        // unresolved role are both "not sent this time" from the
        // batch-summary's point of view — see confirmImport's
        // ConfirmImportPayload comment. This client distinguishes them in
        // its OWN messaging (the confirmError above, and the "held back"
        // note the pilot sees before confirming) but reports one combined
        // count to the server, same as before this change.
        excludedByPilot: excludedByPilot + heldForRole,
      });
      if (outcome.error) {
        setConfirmError(outcome.error);
        return;
      }
      setStage({ kind: "done", fileName: preview.fileName, result, outcome });
    });
  }

  if (stage.kind === "done") {
    const { outcome } = stage;
    const duplicateDetail = outcome.duplicateDetail ?? [];
    return (
      <LCard>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {outcome.partial ? (
              <WarningIcon className="text-warn" />
            ) : (
              <CheckCircleIcon className="text-good" />
            )}
            <h3 className="text-h3 font-semibold">
              {outcome.partial ? "Import didn't finish" : "Import complete"}
            </h3>
          </div>
          {outcome.partial ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>{outcome.partialMessage}</span>
            </LAlert>
          ) : (
            <p className="text-body-s text-ink">
              <span className="tnum-l">{outcome.imported}</span> entr{outcome.imported === 1 ? "y" : "ies"}{" "}
              added to your logbook.
            </p>
          )}
          {outcome.duplicatesInLogbook ? (
            <p className="text-body-s text-ink-2">
              <span className="tnum-l">{outcome.duplicatesInLogbook}</span> row
              {outcome.duplicatesInLogbook === 1 ? "" : "s"} skipped. Already in your logbook from a
              previous import.
            </p>
          ) : null}
          {outcome.duplicatesInFile ? (
            <p className="text-body-s text-ink-2">
              <span className="tnum-l">{outcome.duplicatesInFile}</span> row
              {outcome.duplicatesInFile === 1 ? "" : "s"} skipped. Duplicate of an earlier row in this
              same file, not a previous import. If these are genuinely two different flights (e.g. two
              identical pattern-work hops flown back to back), add the missed one by hand. See the rows
              below.
            </p>
          ) : null}
          {outcome.rejectedCount ? (
            <p className="text-body-s text-warn">
              {outcome.rejectedCount} row{outcome.rejectedCount === 1 ? "" : "s"} couldn&rsquo;t be
              parsed. See the rejected rows below for why.
            </p>
          ) : null}
          <div className="mt-2 flex gap-3">
            <NextLink href="/logbook" className={lButtonClass({ variant: "primary" })}>
              Go to your logbook
            </NextLink>
            <LButton variant="outline" onClick={resetToPick}>
              Import another file
            </LButton>
          </div>
          {duplicateDetail.length > 0 ? (
            <DuplicateTable rows={duplicateDetail} truncated={outcome.duplicateDetailTruncated ?? false} />
          ) : null}
          {/* The SERVER's rejections, not just the client parser's.
              confirmImport now rejects individually any row the logbook
              cannot store (no crew role on a flight, cross-country time
              exceeding total time) instead of aborting the whole file —
              and those reasons are the ones the pilot most needs, because
              they name something in their own data. Returned as
              rejectedDetail; rendering only stage.result.rejected showed
              the count and hid every reason behind it. */}
          {(outcome.rejectedDetail?.length ?? 0) > 0 ? (
            <RejectedTable rejected={outcome.rejectedDetail ?? []} />
          ) : stage.result.rejected.length > 0 ? (
            <RejectedTable rejected={stage.result.rejected} />
          ) : null}
        </div>
      </LCard>
    );
  }

  if (stage.kind === "preview") {
    const { result } = stage;
    const shown = result.valid.slice(0, PREVIEW_ROW_LIMIT);
    const truncated = result.valid.length > PREVIEW_ROW_LIMIT;
    // needsRole does NOT gate confirm: a ForeFlight-shaped source has no
    // role column, and forcing the pilot to resolve every ambiguous row
    // before ANY row can be imported is exactly the "can't force you to
    // group items if they're not already grouped" behavior this screen
    // must not have. A row still needing a role is simply held back from
    // this confirm (see handleConfirm) rather than blocking the rest.
    // needsDevice DOES still gate: simulator_device_type is a much smaller
    // set of rows in practice and, unlike role, the schema's CHECK ties it
    // directly to simulator_time > 0 on the SAME row, so silently holding
    // those back would surprise a pilot who didn't notice a handful of
    // rows vanished from an otherwise-complete import.
    const canConfirm = (summary?.willImportCount ?? 0) > 0 && (summary?.needsDevice ?? 0) === 0 && !pending;

    return (
      <div className="flex flex-col gap-4">
        <LCard>
          <div className="flex flex-col gap-2">
            <h3 className="text-h3 font-semibold">Review before importing</h3>
            {summary && summary.needsRole > 0 ? (
              <LAlert tone="warn" className="flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    {summary.needsRole} row{summary.needsRole === 1 ? "" : "s"} don&rsquo;t give
                    an unambiguous PIC/SIC/Solo/Dual-received signal and can&rsquo;t be inferred.
                    These will be held back when you import (the rest of the batch is not
                    blocked). Pick a role for each, or set one default for all of them, to
                    include them this time:
                  </span>
                  <LButton size="sm" variant="outline" onClick={() => applyDefaultRoleToUndecided("PIC")}>
                    Set undecided to PIC
                  </LButton>
                  <LButton size="sm" variant="outline" onClick={() => applyDefaultRoleToUndecided("SIC")}>
                    Set undecided to SIC
                  </LButton>
                  <LButton size="sm" variant="outline" onClick={() => applyDefaultRoleToUndecided("SOLO")}>
                    Set undecided to Solo
                  </LButton>
                  <LButton
                    size="sm"
                    variant="outline"
                    onClick={() => applyDefaultRoleToUndecided("DUAL_RECEIVED")}
                  >
                    Set undecided to Dual received
                  </LButton>
                </div>
              </LAlert>
            ) : null}
            {summary && summary.needsDevice > 0 ? (
              <LAlert tone="warn" className="flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    {summary.needsDevice} row{summary.needsDevice === 1 ? "" : "s"} log simulator
                    time without saying FFS, FTD, ATD, or other. Pick one for each, or set a default:
                  </span>
                  <LButton size="sm" variant="outline" onClick={() => applyDefaultDeviceToUndecided("ffs")}>
                    Set undecided to FFS
                  </LButton>
                  <LButton size="sm" variant="outline" onClick={() => applyDefaultDeviceToUndecided("ftd")}>
                    Set undecided to FTD
                  </LButton>
                  <LButton size="sm" variant="outline" onClick={() => applyDefaultDeviceToUndecided("atd")}>
                    Set undecided to ATD
                  </LButton>
                </div>
              </LAlert>
            ) : null}
            {truncated ? (
              <LAlert tone="warn" className="flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <span>
                  {`Showing the first ${PREVIEW_ROW_LIMIT} of ${result.valid.length} rows below. All ${result.valid.length} will be imported when you confirm; this table just isn't rendering every one.`}
                </span>
              </LAlert>
            ) : null}
          </div>
        </LCard>

        <LCard>
          <LTable>
            <caption>
              <span className="sr-only">Rows to import</span>
            </caption>
            <thead>
              <tr>
                <LTh>Include</LTh>
                <LTh>Date</LTh>
                <LTh>Aircraft</LTh>
                <LTh>Route</LTh>
                <LTh numeric>Total</LTh>
                <LTh>Role</LTh>
                <LTh>Sim device</LTh>
                <LTh>Notes</LTh>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const s = stateFor(row);
                return (
                  <tr key={row.rowNumber}>
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                    >
                      <LCheckbox
                        checked={s.included}
                        onChange={(e) => updateRow(row.rowNumber, { included: e.target.checked }, row)}
                        aria-label={`Include row ${row.rowNumber}`}
                      />
                    </th>
                    <LTd className="tnum-l">{row.values.entry_date}</LTd>
                    <LTd>
                      <span className="text-ink-2">{row.values.aircraft_ident ?? "—"}</span>
                    </LTd>
                    <LTd>
                      <span className="text-ink-2">
                        {row.values.from_icao ?? "—"} → {row.values.to_icao ?? "—"}
                      </span>
                    </LTd>
                    <LTd numeric>{row.values.total_time.toFixed(1)}</LTd>
                    <LTd>
                      {/* Every row's role is editable, not just
                          "needs_selection" ones — an "inferred" row is a
                          SOFTWARE GUESS, pre-selected here for
                          convenience but never locked in. This matters
                          regulatorily: pic_time > 0 with sic_time = 0
                          infers PIC, but that shape also covers a rated
                          SIC who is sole manipulator and logs PIC time
                          per 61.51(e)(1)(i) while ACTING as SIC — the
                          inference cannot tell those apart, so the pilot
                          must be able to correct it. See the "(inferred)"
                          marker below for what the software guessed,
                          distinct from whatever the pilot ends up
                          choosing. */}
                      <div className="flex flex-col gap-1">
                        <LSelect
                          value={s.role ?? NONE}
                          aria-label={`Role for row ${row.rowNumber}`}
                          onChange={(e) =>
                            updateRow(
                              row.rowNumber,
                              { role: e.target.value === NONE ? null : (e.target.value as LogbookRole) },
                              row
                            )
                          }
                        >
                          <option value={NONE}>Not set</option>
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </LSelect>
                        {row.roleSource === "inferred" ? (
                          <span className="text-caption text-ink-3">Software guessed {row.values.role}</span>
                        ) : null}
                      </div>
                    </LTd>
                    <LTd>
                      {row.needsSimulatorDeviceType ? (
                        <LSelect
                          value={s.simulatorDeviceType ?? NONE}
                          aria-label={`Simulator device for row ${row.rowNumber}`}
                          onChange={(e) =>
                            updateRow(
                              row.rowNumber,
                              {
                                simulatorDeviceType:
                                  e.target.value === NONE ? null : (e.target.value as SimulatorDeviceType),
                              },
                              row
                            )
                          }
                        >
                          <option value={NONE}>Not set</option>
                          {DEVICE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </LSelect>
                      ) : (
                        <span className="text-ink-2">{row.values.simulator_device_type ?? "—"}</span>
                      )}
                    </LTd>
                    <LTd>
                      <span className="text-ink-2">
                        {row.unclassifiedLandings
                          ? `${row.unclassifiedLandings} unclassified landing${row.unclassifiedLandings === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </LTd>
                  </tr>
                );
              })}
            </tbody>
          </LTable>
        </LCard>

        {result.rejected.length > 0 ? <RejectedTable rejected={result.rejected} /> : null}

        {confirmError ? (
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{confirmError}</span>
          </LAlert>
        ) : null}

        <div className="flex gap-3">
          <LButton onClick={handleConfirm} disabled={!canConfirm}>
            {pending
              ? "Importing…"
              : `Import ${summary?.willImportCount ?? 0} entr${(summary?.willImportCount ?? 0) === 1 ? "y" : "ies"}`}
          </LButton>
          <LButton variant="outline" onClick={resetToPick} disabled={pending}>
            Start over
          </LButton>
        </div>
      </div>
    );
  }

  if (stage.kind === "map-generic") {
    return (
      <LCard>
        <div className="flex flex-col gap-3">
          <h3 className="text-h3 font-semibold">Match your columns</h3>
          <LTable>
            <caption>
              <span className="sr-only">Column mapping</span>
            </caption>
            <thead>
              <tr>
                <LTh>Your column</LTh>
                <LTh>Sample</LTh>
                <LTh>Maps to</LTh>
              </tr>
            </thead>
            <tbody>
              {stage.header.map((h, idx) => (
                <tr key={`${h}-${idx}`}>
                  <th
                    scope="row"
                    className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                  >
                    {h || `Column ${idx + 1}`}
                  </th>
                  <LTd>
                    <span className="text-ink-2">{stage.dataRecords[0]?.fields[idx] ?? ""}</span>
                  </LTd>
                  <LTd>
                    <LSelect
                      value={stage.mapping[idx] ?? "ignore"}
                      aria-label={`Field for column ${h || idx + 1}`}
                      onChange={(e) => {
                        const nextMapping = [...stage.mapping];
                        nextMapping[idx] = e.target.value as ColumnMapping[number];
                        setStage({ ...stage, mapping: nextMapping });
                      }}
                    >
                      <option value="ignore">Ignore this column</option>
                      {MAPPABLE_FIELDS.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                          {f.required ? " (required)" : ""}
                        </option>
                      ))}
                    </LSelect>
                  </LTd>
                </tr>
              ))}
            </tbody>
          </LTable>
          {parseError ? (
            <LAlert tone="crit" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-crit" />
              <span>{parseError}</span>
            </LAlert>
          ) : null}
          <div className="flex gap-3">
            <LButton onClick={applyGenericStage}>Continue to preview</LButton>
            <LButton variant="outline" onClick={resetToPick}>
              Start over
            </LButton>
          </div>
        </div>
      </LCard>
    );
  }

  // stage.kind === "pick"
  return (
    <LCard>
      <div className="flex flex-col gap-4">
        <LTabsRoot value={format} onValueChange={(v) => setFormat(v as ImportFormat)}>
          <LTabsList aria-label="Logbook file format">
            <LTabsTrigger value="foreflight">ForeFlight</LTabsTrigger>
            <LTabsTrigger value="logten">LogTen</LTabsTrigger>
            <LTabsTrigger value="generic_csv">Any other CSV</LTabsTrigger>
          </LTabsList>
        </LTabsRoot>
        <p className="text-body-s text-ink-2">
          {format === "foreflight"
            ? "Upload the CSV from ForeFlight's Logbook export (Logbook → Export)."
            : format === "logten"
              ? "Upload a CSV export from LogTen."
              : "Upload any CSV. You'll match its columns to logbook fields yourself on the next step. This is the path for any logbook that isn't ForeFlight or LogTen."}
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor={fileInputId} className="text-body-s font-medium text-ink">
            CSV file
          </label>
          {/* A plain file input, same pattern as app/(app)/expenses/expense-form.tsx's receipt field — this file is read client-side (FileReader) and never uploaded as bytes; only the parsed, pilot-confirmed rows reach the server. */}
          <input
            id={fileInputId}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="text-body-s text-ink"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>
        {parseError ? (
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{parseError}</span>
          </LAlert>
        ) : null}
        <p className="text-caption text-ink-3">
          Nothing is written to your logbook until you review and confirm on the next screen.
        </p>
      </div>
    </LCard>
  );
}

/** Turns a sourceRow (header -> cell) into a compact, readable line — the
 * closest thing a valid (non-rejected) row has to RejectedTable's `raw`
 * string, since a valid row was never stored as one raw line to begin
 * with. */
function summarizeSourceRow(sourceRow: Record<string, string>): string {
  return Object.entries(sourceRow)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

function DuplicateTable({ rows, truncated }: { rows: DuplicateRowDetail[]; truncated: boolean }) {
  const shown = rows.slice(0, DUPLICATE_ROW_LIMIT);
  return (
    <LCard>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <LPill tone="neutral">{rows.length} duplicate{rows.length === 1 ? "" : "s"}</LPill>
          <h3 className="text-lead font-semibold">Rows skipped as duplicates</h3>
        </div>
        <p className="text-caption text-ink-3">
          &ldquo;Already in your logbook&rdquo; rows match a flight from a previous import.
          &ldquo;Duplicate in this file&rdquo; rows match an earlier row in THIS file. If that&rsquo;s a
          real second flight (not a data-entry repeat), add it by hand.
        </p>
        {truncated ? (
          <p className="text-caption text-warn">
            {`Showing the first ${DUPLICATE_ROW_LIMIT} of ${rows.length} duplicate rows.`}
          </p>
        ) : null}
        <LTable>
          <caption>
            <span className="sr-only">Rows skipped as duplicates</span>
          </caption>
          <thead>
            <tr>
              <LTh>Row</LTh>
              <LTh>Why skipped</LTh>
              <LTh>Original row</LTh>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.rowNumber}>
                <th
                  scope="row"
                  className="tnum-l border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                >
                  {r.rowNumber}
                </th>
                <LTd>
                  <span className={r.kind === "in_file" ? "text-warn" : "text-ink-2"}>
                    {r.kind === "in_file" ? "Duplicate in this file" : "Already in your logbook"}
                  </span>
                </LTd>
                <LTd>
                  <code className="rounded-control bg-sunk px-1.5 py-0.5 font-mono text-caption text-ink-2">
                    {summarizeSourceRow(r.sourceRow).slice(0, 300)}
                  </code>
                </LTd>
              </tr>
            ))}
          </tbody>
        </LTable>
      </div>
    </LCard>
  );
}

function RejectedTable({ rejected }: { rejected: { rowNumber: number; raw: string; reason: string }[] }) {
  const shown = rejected.slice(0, REJECTED_ROW_LIMIT);
  const truncated = rejected.length > REJECTED_ROW_LIMIT;
  return (
    <LCard>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <LPill tone="warn">{rejected.length} rejected</LPill>
          <h3 className="text-lead font-semibold">Rows that couldn&rsquo;t be imported</h3>
        </div>
        <p className="text-caption text-ink-3">
          These rows were not written to your logbook. Fix them in your source file and re-import,
          or add them by hand.
        </p>
        {truncated ? (
          <p className="text-caption text-warn">
            {`Showing the first ${REJECTED_ROW_LIMIT} of ${rejected.length} rejected rows.`}
          </p>
        ) : null}
        <LTable>
          <caption>
            <span className="sr-only">Rows that couldn&rsquo;t be imported</span>
          </caption>
          <thead>
            <tr>
              <LTh>Row</LTh>
              <LTh>Reason</LTh>
              <LTh>Original line</LTh>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.rowNumber}>
                <th
                  scope="row"
                  className="tnum-l border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                >
                  {r.rowNumber}
                </th>
                <LTd>
                  <span className="text-crit">{r.reason}</span>
                </LTd>
                <LTd>
                  <code className="rounded-control bg-sunk px-1.5 py-0.5 font-mono text-caption text-ink-2">
                    {r.raw.slice(0, 300)}
                  </code>
                </LTd>
              </tr>
            ))}
          </tbody>
        </LTable>
      </div>
    </LCard>
  );
}

/* ── Inline icons ──────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shape as invoices/page.tsx's own WarningIcon. */
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

function CheckCircleIcon({ className }: { className?: string }) {
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
      <path d="M5.25 8.25 7.25 10.25 10.75 6" />
    </svg>
  );
}
