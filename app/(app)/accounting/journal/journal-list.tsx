"use client";

import { useState, useTransition } from "react";
import { LButton, LCard, LEmpty, LPill, LTd } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { formatCents, formatDate } from "@/lib/format";
import { deleteJournalEntry } from "./actions";

export type JournalLineView = {
  id: string;
  accountName: string;
  side: "debit" | "credit";
  amountCents: number;
};

export type JournalEntryView = {
  id: string;
  entryDate: string;
  memo: string;
  sourceType: string;
  lines: JournalLineView[];
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "manual",
  invoice_issued: "invoice",
  invoice_voided: "void",
  payment: "payment",
  payment_void_reclass: "held",
  expense: "expense",
  mileage: "mileage",
};

function EntryCard({ entry }: { entry: JournalEntryView }) {
  const [deleting, startDelete] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    // Closes the instant it's pressed, same posture as invoices/[id]/
    // lines-editor.tsx's EditableRow: not gated on the async result.
    // deleteError renders below the Delete button, after the dialog is
    // already gone.
    setConfirmOpen(false);
    startDelete(async () => {
      setDeleteError(null);
      const result = await deleteJournalEntry(entry.id);
      if (result.error) setDeleteError(result.error);
    });
  }

  return (
    <LCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-s font-medium text-ink">
            {formatDate(entry.entryDate)}
          </span>
          <span className="text-body-s text-ink">{entry.memo}</span>
          <LPill tone={entry.sourceType === "manual" ? "accent" : "neutral"}>
            {SOURCE_LABEL[entry.sourceType] ?? entry.sourceType}
          </LPill>
        </div>
        {entry.sourceType === "manual" ? (
          <>
            <LButton
              type="button"
              size="sm"
              variant="quiet"
              className="text-crit hover:text-crit"
              onClick={() => setConfirmOpen(true)}
            >
              Delete
            </LButton>
            <LConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="Delete this journal entry?"
              description={
                <>
                  {formatDate(entry.entryDate)}: {entry.memo}. Fixing a
                  mistake means deleting and re-entering it. This
                  can&rsquo;t be undone.
                </>
              }
              confirmLabel="Delete"
              confirmVariant="danger"
              pending={deleting}
              onConfirm={handleDelete}
            />
          </>
        ) : null}
      </div>
      {deleteError ? (
        <p className="mt-1 text-caption font-medium text-crit" role="alert">
          {deleteError}
        </p>
      ) : null}
      <table className="mt-2 w-full border-collapse text-body-s">
        <caption>
          <span className="sr-only">Entry lines</span>
        </caption>
        <tbody>
          {entry.lines.map((line) => (
            <tr key={line.id}>
              <LTd className="border-b-0 py-1">
                <span className="text-ink-2">{line.accountName}</span>
              </LTd>
              <LTd numeric className="border-b-0 py-1">
                {line.side === "debit" ? formatCents(line.amountCents) : ""}
              </LTd>
              <LTd numeric className="border-b-0 py-1 text-ink-2">
                {line.side === "credit" ? formatCents(line.amountCents) : ""}
              </LTd>
            </tr>
          ))}
        </tbody>
      </table>
    </LCard>
  );
}

export default function JournalList({ entries }: { entries: JournalEntryView[] }) {
  if (entries.length === 0) {
    return (
      <LCard>
        <LEmpty title="No journal entries yet">
          Issue an invoice, record a payment, or log an expense, and it posts
          here automatically. You can also record a manual entry above.
        </LEmpty>
      </LCard>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
