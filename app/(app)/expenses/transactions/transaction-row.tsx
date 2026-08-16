"use client";

import { useState } from "react";
import { LAlert, LButton, LPill, LTd } from "@/components/ledger";
import { LSelect } from "@/components/ledger/forms";
import { formatCents, formatDate } from "@/lib/format";
import type { OptionChoice } from "@/lib/custom-options";
import { confirmTransaction, ignoreTransaction } from "./actions";

const TREATMENTS = [
  { value: "unassigned", label: "Decide later" },
  { value: "rebill", label: "Rebill to the client" },
  { value: "deduct", label: "Keep as a deduction" },
];

const NO_TRIP = "none";

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
}: {
  txn: TransactionRowData;
  trips: TripOption[];
  /** The tenant's own category vocabulary — see expense-form.tsx. */
  categories: readonly OptionChoice[];
}) {
  const isExpenseCandidate = txn.amount_cents < 0;
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(txn.suggested_category ?? "other");
  const [treatment, setTreatment] = useState("unassigned");
  const [tripId, setTripId] = useState(NO_TRIP);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Gates "Confirm as expense" when this spend looks like one already in
  // the books. Not a nag: the pilot has to say which it is before the
  // second expense can exist, because the wrong answer is invisible here
  // and shows up on a client's invoice.
  const [acknowledgedDuplicate, setAcknowledgedDuplicate] = useState(false);
  const [done, setDone] = useState<"confirmed" | "ignored" | null>(null);

  const handleConfirm = async () => {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", txn.id);
    fd.set("category", category);
    fd.set("treatment", treatment);
    fd.set("trip_id", tripId === NO_TRIP ? "" : tripId);
    const result = await confirmTransaction(fd);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone("confirmed");
  };

  const handleIgnore = async () => {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", txn.id);
    const result = await ignoreTransaction(fd);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone("ignored");
  };

  if (done) {
    return (
      <tr>
        <td colSpan={5} className="border-b border-hair px-3 py-2.5 align-baseline">
          <span className="text-body-s text-ink-2">
            {done === "confirmed" ? "Saved as an expense." : "Dismissed, not an expense."}
          </span>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr>
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
          {txn.suggested_category ? (
            <LPill tone="accent">Suggested: {txn.suggested_category}</LPill>
          ) : null}
          {!isExpenseCandidate ? <LPill tone="neutral">Deposit / payment</LPill> : null}
        </LTd>
        <LTd>
          {isExpenseCandidate ? (
            <LButton type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
              {open ? "Cancel" : "Review"}
            </LButton>
          ) : (
            <LButton type="button" size="sm" variant="outline" onClick={handleIgnore} disabled={pending}>
              Dismiss
            </LButton>
          )}
        </LTd>
      </tr>
      {open ? (
        <tr>
          <td colSpan={5} className="border-b border-hair px-3 py-2.5 align-baseline">
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
              <div>
                {txn.duplicates.length > 0 && !acknowledgedDuplicate ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <LButton
                      type="button"
                      variant="outline"
                      onClick={() => setAcknowledgedDuplicate(true)}
                      disabled={pending}
                    >
                      It&rsquo;s a different charge: record it anyway
                    </LButton>
                    <LButton type="button" variant="outline" onClick={handleIgnore} disabled={pending}>
                      Dismiss as a duplicate
                    </LButton>
                  </div>
                ) : (
                  <LButton type="button" onClick={handleConfirm} disabled={pending}>
                    {pending ? "Saving…" : "Confirm as expense"}
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
