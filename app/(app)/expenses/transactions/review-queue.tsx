"use client";

import { useEffect, useRef, useState } from "react";
import { LAlert, LButton, LTable, LTh } from "@/components/ledger";
import { LCheckbox } from "@/components/ledger/forms";
import type { OptionChoice } from "@/lib/custom-options";
import TransactionRow, {
  type ResolvedState,
  type TransactionRowData,
  type TripOption,
} from "./transaction-row";
import { bulkConfirmTransactions, bulkIgnoreTransactions } from "./actions";
import { MAX_BULK_TRANSACTIONS } from "./bulk-limit";

/**
 * The review queue's table, and the one place that knows which rows are
 * ticked.
 *
 * Selection has to live above the rows — a bulk pass resolves rows whose
 * own components never fired an action — so this component also owns what
 * each row's `done` state used to be. A row still runs its own single-row
 * confirm and dismiss; it just reports the outcome upwards instead of
 * remembering it privately.
 *
 * WHAT A BULK BUTTON MAY TOUCH. Exactly the ids that are ticked AND still
 * eligible at the moment of the click — never "all deposits", never a
 * filter the server re-derives, never a row that has since been resolved
 * or flagged. The ids travel in the FormData; ./actions.ts loops the same
 * per-row validated actions over them and hands back per-row failures,
 * which land back on the rows they belong to.
 */
export default function ReviewQueue({
  rows,
  trips,
  categories,
}: {
  rows: TransactionRowData[];
  trips: TripOption[];
  categories: readonly OptionChoice[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Record<string, ResolvedState>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<null | "confirm" | "dismiss">(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // A duplicate-flagged row is never ticked: the acknowledgement that
  // gates its confirm has no place in a bulk pass, and the server refuses
  // it anyway (see bulkConfirmTransactions). Decided one at a time, in
  // Review, where the candidates are on screen.
  const isSelectable = (t: TransactionRowData) => !resolved[t.id] && t.duplicates.length === 0;
  // Only a negative amount with a suggestion can be confirmed unattended:
  // a deposit is not an expense, and a row with no suggestion has no
  // category for the bulk pass to use.
  const isConfirmable = (t: TransactionRowData) =>
    isSelectable(t) && t.amount_cents < 0 && t.suggested_category !== null;

  const selectableRows = rows.filter(isSelectable);
  const selectedRows = selectableRows.filter((t) => selected.has(t.id));
  const confirmableSelected = selectedRows.filter(isConfirmable);
  const skippedByConfirm = selectedRows.length - confirmableSelected.length;
  const overLimit = selectedRows.length > MAX_BULK_TRANSACTIONS;

  const allSelected = selectableRows.length > 0 && selectedRows.length === selectableRows.length;
  const someSelected = selectedRows.length > 0;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const setRowSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = () => {
    setBulkNote(null);
    setBulkError(null);
    if (someSelected) {
      setSelected(new Set());
      return;
    }
    // Capped at what one call takes, so "select all" on a fat statement
    // lands on a working selection rather than a disabled button.
    const take = selectableRows.slice(0, MAX_BULK_TRANSACTIONS);
    setSelected(new Set(take.map((t) => t.id)));
    if (selectableRows.length > take.length) {
      setBulkNote(
        `Selected the first ${take.length} of ${selectableRows.length} — that's the most one pass takes. Do the rest on the next pass.`
      );
    }
  };

  const markResolved = (id: string, state: ResolvedState) => {
    setResolved((prev) => ({ ...prev, [id]: state }));
    setRowErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const runBulk = async (
    which: "confirm" | "dismiss",
    ids: string[],
    action: typeof bulkConfirmTransactions
  ) => {
    if (ids.length === 0) return;
    setPending(which);
    setBulkError(null);
    setBulkNote(null);
    setRowErrors({});

    const fd = new FormData();
    for (const id of ids) fd.append("id", id);
    const result = await action(fd);
    setPending(null);

    if (result.error) {
      setBulkError(result.error);
      return;
    }

    const state: ResolvedState = which === "confirm" ? "confirmed" : "ignored";
    setResolved((prev) => {
      const next = { ...prev };
      for (const id of result.succeeded) next[id] = state;
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of result.succeeded) next.delete(id);
      return next;
    });
    setRowErrors(Object.fromEntries(result.failures.map((f) => [f.id, f.error])));

    const verb = which === "confirm" ? "confirmed" : "dismissed";
    const done = result.succeeded.length === 1 ? `1 transaction ${verb}.` : `${result.succeeded.length} transactions ${verb}.`;
    setBulkNote(
      result.failures.length > 0
        ? `${done} ${result.failures.length} still need${result.failures.length === 1 ? "s" : ""} you — the reason is on each row below.`
        : done
    );
  };

  const handleBulkConfirm = () =>
    runBulk(
      "confirm",
      confirmableSelected.map((t) => t.id),
      bulkConfirmTransactions
    );

  const handleBulkDismiss = () =>
    runBulk(
      "dismiss",
      selectedRows.map((t) => t.id),
      bulkIgnoreTransactions
    );

  return (
    <div className="flex flex-col gap-2">
      {selectableRows.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-s text-ink-2">
              {selectedRows.length === 0
                ? "Tick rows to confirm or dismiss several at once."
                : `${selectedRows.length} selected`}
            </span>
            {selectedRows.length > 0 ? (
              <>
                <LButton
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleBulkConfirm}
                  disabled={pending !== null || overLimit || confirmableSelected.length === 0}
                >
                  {pending === "confirm"
                    ? `Confirming ${confirmableSelected.length}…`
                    : `Confirm ${confirmableSelected.length} as ${confirmableSelected.length === 1 ? "a deduction" : "deductions"}`}
                </LButton>
                <LButton
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleBulkDismiss}
                  disabled={pending !== null || overLimit}
                >
                  {pending === "dismiss"
                    ? `Dismissing ${selectedRows.length}…`
                    : `Dismiss ${selectedRows.length}`}
                </LButton>
                <LButton
                  type="button"
                  size="sm"
                  variant="quiet"
                  onClick={() => setSelected(new Set())}
                  disabled={pending !== null}
                >
                  Clear
                </LButton>
              </>
            ) : null}
          </div>
          {/* Says what the bulk confirm will actually do BEFORE it is
              clicked. "As deductions" is the whole promise: each row is
              filed at its own suggested category, kept as a deduction, and
              attached to no trip — so nothing here can put a line on a
              client's invoice. */}
          {selectedRows.length > 0 ? (
            <p className="text-caption text-ink-3">
              Confirming files each one at its own suggested category and keeps it as a
              deduction — nothing gets rebilled to a client. Use Review for anything you
              want to rebill or categorise differently.
              {skippedByConfirm > 0
                ? ` ${skippedByConfirm} of the selected ${skippedByConfirm === 1 ? "row is a deposit or has" : "rows are deposits or have"} no suggested category, so ${skippedByConfirm === 1 ? "it isn't" : "they aren't"} included in the confirm.`
                : ""}
            </p>
          ) : null}
          {overLimit ? (
            <p className="text-caption font-medium text-warn">
              {MAX_BULK_TRANSACTIONS} at a time is the most one pass takes. Untick{" "}
              {selectedRows.length - MAX_BULK_TRANSACTIONS} and go again.
            </p>
          ) : null}
          {bulkNote ? <p className="text-caption text-ink-2">{bulkNote}</p> : null}
          {bulkError ? <LAlert tone="crit">{bulkError}</LAlert> : null}
        </div>
      ) : null}

      <LTable>
        <thead>
          <tr>
            <LTh className="w-8">
              <label className="flex size-6 cursor-pointer items-center justify-center">
                <LCheckbox
                  ref={selectAllRef}
                  checked={allSelected}
                  disabled={selectableRows.length === 0 || pending !== null}
                  onChange={toggleAll}
                />
                <span className="sr-only">Select every transaction that can be actioned in bulk</span>
              </label>
            </LTh>
            <LTh>Date</LTh>
            <LTh>Description</LTh>
            <LTh numeric>Amount</LTh>
            <LTh />
            <LTh />
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <TransactionRow
              key={t.id}
              txn={t}
              trips={trips}
              categories={categories}
              selectable={isSelectable(t)}
              selected={selected.has(t.id)}
              onSelectedChange={(checked) => setRowSelected(t.id, checked)}
              resolved={resolved[t.id] ?? null}
              onResolved={(state) => markResolved(t.id, state)}
              bulkError={rowErrors[t.id] ?? null}
              disabled={pending !== null}
            />
          ))}
        </tbody>
      </LTable>
    </div>
  );
}
