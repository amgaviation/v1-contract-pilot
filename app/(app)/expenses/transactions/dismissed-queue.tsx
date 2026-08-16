"use client";

import { useState } from "react";
import { LButton, LPill, LTable, LTd, LTh } from "@/components/ledger";
import { formatCents, formatDate } from "@/lib/format";
import { unignoreTransaction } from "./actions";

export type DismissedRow = {
  id: string;
  posted_on: string;
  description: string;
  amount_cents: number;
  /** 'ignored' can be undone; 'orphaned' (reviewed, expense since deleted) cannot — see unignoreTransaction's header. */
  kind: "ignored" | "orphaned";
};

/**
 * The other half of the review queue: rows a pilot dismissed, plus rows
 * whose expense was deleted out from under them (bank_transactions.expense_id
 * ON DELETE SET NULL — the schema calls this "a rare, visible" state, which
 * required this list to exist for it to actually be visible anywhere).
 *
 * Collapsed by default — the everyday queue above is /expenses/transactions'
 * whole point, and most pilots most of the time have nothing dismissed to
 * revisit.
 */
export default function DismissedQueue({ rows }: { rows: DismissedRow[] }) {
  const [open, setOpen] = useState(false);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4">
      <LButton type="button" size="sm" variant="quiet" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Show"} dismissed &amp; unrecoverable ({rows.length})
      </LButton>
      {open ? (
        <div className="mt-2 overflow-x-auto">
          <LTable>
            <thead>
              <tr>
                <LTh>Date</LTh>
                <LTh>Description</LTh>
                <LTh numeric>Amount</LTh>
                <LTh />
                <LTh />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DismissedRowItem key={row.id} row={row} />
              ))}
            </tbody>
          </LTable>
        </div>
      ) : null}
    </div>
  );
}

function DismissedRowItem({ row }: { row: DismissedRow }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const handleUndo = async () => {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", row.id);
    const result = await unignoreTransaction(fd);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRestored(true);
  };

  return (
    <tr>
      <th
        scope="row"
        className="tnum-l border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
      >
        {formatDate(row.posted_on)}
      </th>
      <LTd>{row.description}</LTd>
      <LTd numeric>{formatCents(Math.abs(row.amount_cents))}</LTd>
      <LTd>
        {row.kind === "orphaned" ? (
          <LPill tone="neutral">The expense this became was deleted</LPill>
        ) : (
          <LPill tone="neutral">Dismissed</LPill>
        )}
      </LTd>
      <LTd>
        {row.kind === "ignored" ? (
          restored ? (
            <span className="text-caption text-ink-3">Back in the queue above.</span>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <LButton type="button" size="sm" variant="outline" onClick={handleUndo} disabled={pending}>
                {pending ? "Restoring…" : "Undo"}
              </LButton>
              {error ? <span className="text-caption font-medium text-crit">{error}</span> : null}
            </div>
          )
        ) : null}
      </LTd>
    </tr>
  );
}
