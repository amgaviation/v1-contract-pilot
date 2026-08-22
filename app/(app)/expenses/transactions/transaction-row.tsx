"use client";

import { useState } from "react";
import { LAlert, LButton, LPill, LTd } from "@/components/ledger";
import { LCheckbox, LSelect } from "@/components/ledger/forms";
import { formatCents, formatDate } from "@/lib/format";
import type { OptionChoice } from "@/lib/custom-options";
import { confirmTransaction, ignoreTransaction, quickConfirmTransaction } from "./actions";

const TREATMENTS = [
  { value: "unassigned", label: "Decide later" },
  { value: "rebill", label: "Rebill to the client" },
  { value: "deduct", label: "Keep as a deduction" },
];

const NO_TRIP = "none";

/** How this row left the queue — held by ./review-queue.tsx, because a bulk pass resolves rows this component never heard from. */
export type ResolvedState = "confirmed" | "ignored";

/**
 * An expense already in the books that looks like this same spend — same
 * amount, within a few days. Deliberately NOT matched on description: the
 * imported row carries the raw bank descriptor ("SYNTH INN 88 SYNTHETIC
 * RD") while a hand-entered one carries whatever the pilot typed ("SYNTH
 * INN 88"), so descriptions are precisely what does NOT match on a real
 * duplicate.
 */
export type DuplicateCandidate = {
  incurredOn: string;
  vendor: string | null;
  amountCents: number;
  treatment: string;
  /** True when that expense also came from a bank import, not a receipt. */
  fromBank: boolean;
};

export type TransactionRowData = {
  id: string;
  posted_on: string;
  description: string;
  amount_cents: number;
  bank_account_label: string;
  suggested_category: string | null;
  duplicates: DuplicateCandidate[];
};

export type TripOption = { id: string; label: string };

export default function TransactionRow({
  txn,
  trips,
  categories,
  selectable,
  selected,
  onSelectedChange,
  resolved,
  onResolved,
  bulkError,
  disabled,
}: {
  txn: TransactionRowData;
  trips: TripOption[];
  /** The tenant's own category vocabulary — see expense-form.tsx. */
  categories: readonly OptionChoice[];
  /** False on duplicate-flagged rows: those are decided one at a time, never in a bulk pass. */
  selectable: boolean;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
  resolved: ResolvedState | null;
  onResolved: (state: ResolvedState) => void;
  /** Why the last bulk pass couldn't move this row. */
  bulkError: string | null;
  /** A bulk action is in flight; this row's own buttons stand down until it lands. */
  disabled: boolean;
}) {
  const isExpenseCandidate = txn.amount_cents < 0;
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(txn.suggested_category ?? "other");
  const [treatment, setTreatment] = useState("unassigned");
  const [tripId, setTripId] = useState(NO_TRIP);
  const [pending, setPending] = useState<null | "quick" | "confirm" | "ignore">(null);
  const [error, setError] = useState<string | null>(null);
  // Gates "Confirm as expense" when this spend looks like one already in
  // the books. Not a nag: the pilot has to say which it is before the
  // second expense can exist, because the wrong answer is invisible here
  // and shows up on a client's invoice.
  const [acknowledgedDuplicate, setAcknowledgedDuplicate] = useState(false);

  const busy = pending !== null || disabled;

  // The suggestion the row already displays, under the tenant's own name
  // for it. The pill used to print the raw key ("rental_car"); it prints a
  // label now because the one-click confirm below acts on exactly this
  // value, and a pilot cannot vet a category they are shown in schema.
  const suggestedLabel = txn.suggested_category
    ? categories.find((c) => c.value === txn.suggested_category)?.label ?? txn.suggested_category
    : null;

  /**
   * ONE CLICK FOR THE ORDINARY CASE. A self-funded charge the importer
   * already categorised needs no decision — expanding the row only to
   * re-pick what the row is showing and choose "Keep as a deduction" is
   * the click tax this queue is famous for. Offered ONLY where there is
   * nothing to weigh up: a real suggestion, an actual expense (negative),
   * and no duplicate candidates in the snapshot this page rendered from.
   *
   * That last one is an AFFORDANCE, not the gate. The snapshot can be
   * stale (a receipt filed in another tab since the page loaded) and it
   * is empty both when there are genuinely no candidates and when the
   * queue's own probe failed — so quickConfirmTransaction re-runs the
   * duplicate check server-side and refuses, exactly as the bulk pass
   * does. What is hidden here is a convenience; what is enforced is over
   * there.
   */
  const quickConfirmable =
    isExpenseCandidate && txn.suggested_category !== null && txn.duplicates.length === 0;

  const handleConfirm = async () => {
    setPending("confirm");
    setError(null);
    const fd = new FormData();
    fd.set("id", txn.id);
    fd.set("category", category);
    fd.set("treatment", treatment);
    fd.set("trip_id", tripId === NO_TRIP ? "" : tripId);
    const result = await confirmTransaction(fd);
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    onResolved("confirmed");
  };

  const handleQuickConfirm = async () => {
    setPending("quick");
    setError(null);
    // Id only: the category is the row's own suggestion, read server-side,
    // so the button cannot promise one thing and file another.
    const fd = new FormData();
    fd.set("id", txn.id);
    const result = await quickConfirmTransaction(fd);
    setPending(null);
    if (result.error) {
      setError(result.error);
      // Refused — put the pilot where the decision actually gets made
      // rather than leaving them with a sentence and a collapsed row. The
      // Review path is unchanged and still confirms whatever they choose.
      setOpen(true);
      return;
    }
    onResolved("confirmed");
  };

  const handleIgnore = async () => {
    setPending("ignore");
    setError(null);
    const fd = new FormData();
    fd.set("id", txn.id);
    const result = await ignoreTransaction(fd);
    setPending(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    onResolved("ignored");
  };

  if (resolved) {
    return (
      <tr>
        <td colSpan={6} className="border-b border-hair px-3 py-2.5 align-baseline">
          <span className="text-body-s text-ink-2">
            {resolved === "confirmed" ? "Saved as an expense." : "Dismissed, not an expense."}
          </span>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr>
        <LTd className="w-8">
          <label className="flex size-6 cursor-pointer items-center justify-center">
            <LCheckbox
              checked={selected}
              disabled={!selectable || busy}
              onChange={(e) => onSelectedChange(e.target.checked)}
              title={
                selectable
                  ? undefined
                  : "This one looks like an expense you already recorded — decide it on its own."
              }
            />
            <span className="sr-only">
              Select {txn.description} on {formatDate(txn.posted_on)}
            </span>
          </label>
        </LTd>
        <th
          scope="row"
          className="tnum-l border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
        >
          {formatDate(txn.posted_on)}
        </th>
        <LTd>
          <div className="flex flex-col">
            <span>{txn.description}</span>
            <span className="text-caption text-ink-3">{txn.bank_account_label}</span>
          </div>
        </LTd>
        <LTd numeric>
          <span className={isExpenseCandidate ? "text-crit" : "text-good"}>
            {isExpenseCandidate ? "−" : "+"}
            {formatCents(Math.abs(txn.amount_cents))}
          </span>
        </LTd>
        <LTd>
          <div className="flex flex-wrap items-center gap-1">
            {suggestedLabel ? <LPill tone="accent">Suggested: {suggestedLabel}</LPill> : null}
            {!isExpenseCandidate ? <LPill tone="neutral">Deposit / payment</LPill> : null}
            {/* Says on the collapsed row why this one has no one-click
                confirm and no checkbox — the warning itself is inside
                Review, but its consequences are visible out here. */}
            {txn.duplicates.length > 0 ? <LPill tone="warn">Possible duplicate</LPill> : null}
          </div>
        </LTd>
        <LTd>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isExpenseCandidate ? (
                <>
                  {quickConfirmable && !open ? (
                    <LButton
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleQuickConfirm}
                      disabled={busy}
                      title={`Files this as ${suggestedLabel} and keeps it as a deduction. Nothing gets rebilled to a client.`}
                    >
                      {pending === "quick" ? "Saving…" : "Confirm as deduction"}
                    </LButton>
                  ) : null}
                  <LButton
                    type="button"
                    size="sm"
                    variant={quickConfirmable && !open ? "quiet" : "outline"}
                    onClick={() => setOpen((v) => !v)}
                    disabled={busy}
                  >
                    {open ? "Cancel" : "Review"}
                  </LButton>
                </>
              ) : (
                <LButton type="button" size="sm" variant="outline" onClick={handleIgnore} disabled={busy}>
                  {pending === "ignore" ? "Dismissing…" : "Dismiss"}
                </LButton>
              )}
            </div>
            {!open && error ? (
              <span className="text-caption font-medium text-crit">{error}</span>
            ) : null}
            {!open && !error && bulkError ? (
              <span className="text-caption font-medium text-crit">{bulkError}</span>
            ) : null}
          </div>
        </LTd>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} className="border-b border-hair px-3 py-2.5 align-baseline">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <span className="text-caption text-ink-3">Category</span>
                  <LSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                    {categories.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </LSelect>
                </div>
                <div>
                  <span className="text-caption text-ink-3">Treatment</span>
                  <LSelect value={treatment} onChange={(e) => setTreatment(e.target.value)}>
                    {TREATMENTS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </LSelect>
                </div>
                {treatment === "rebill" ? (
                  <div>
                    <span className="text-caption text-ink-3">Trip</span>
                    <LSelect value={tripId} onChange={(e) => setTripId(e.target.value)}>
                      <option value={NO_TRIP}>No trip</option>
                      {trips.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </LSelect>
                  </div>
                ) : null}
              </div>
              {/* ALREADY IN THE BOOKS. Warns, never blocks — two
                  identical same-day charges are real. But the confirm is
                  gated behind an explicit acknowledgement, because the
                  failure this prevents is silent and lands on someone
                  else: a duplicated rebill reaches the client as two
                  invoice lines for one spend. */}
              {txn.duplicates.length > 0 ? (
                <LAlert tone="warn">
                  <p className="mb-1 font-medium">You may have already recorded this.</p>
                  {txn.duplicates.map((d, i) => (
                    <p className="text-caption" key={`${d.incurredOn}-${i}`}>
                      {formatCents(d.amountCents)} on {formatDate(d.incurredOn)}
                      {d.vendor ? `, ${d.vendor}` : ""}
                      {d.treatment === "rebill" ? " (rebilled to a client)" : ""}
                      {d.fromBank ? " (from another statement)" : " (entered by hand)"}
                    </p>
                  ))}
                  <p className="mt-1 text-caption">
                    Confirming this makes a second expense. If it&rsquo;s the same
                    spend, dismiss this row instead.
                  </p>
                </LAlert>
              ) : null}
              {error ? <LAlert tone="crit">{error}</LAlert> : null}
              {bulkError && !error ? <LAlert tone="crit">{bulkError}</LAlert> : null}
              <div>
                {txn.duplicates.length > 0 && !acknowledgedDuplicate ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <LButton
                      type="button"
                      variant="outline"
                      onClick={() => setAcknowledgedDuplicate(true)}
                      disabled={busy}
                    >
                      It&rsquo;s a different charge: record it anyway
                    </LButton>
                    <LButton type="button" variant="outline" onClick={handleIgnore} disabled={busy}>
                      {pending === "ignore" ? "Dismissing…" : "Dismiss as a duplicate"}
                    </LButton>
                  </div>
                ) : (
                  <LButton type="button" onClick={handleConfirm} disabled={busy}>
                    {pending === "confirm" ? "Saving…" : "Confirm as expense"}
                  </LButton>
                )}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
