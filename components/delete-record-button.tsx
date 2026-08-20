"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";

/**
 * ONE DELETE BUTTON, for the five records that grew one at once.
 *
 * Invoices, clients, aircraft, crew and an expense's receipt all needed
 * the identical shape — outline button, confirm dialog, keep the dialog
 * OPEN on failure so focus stays on the still-enabled confirm button
 * instead of falling back to <body>, then navigate once it lands. That
 * shape already existed three times over (delete-expense-button,
 * delete-logbook-entry-button, the two archive buttons), and copying it
 * five more times is how the two HEIC magic-byte checks ended up
 * disagreeing with each other.
 *
 * THE ACTION ARRIVES BOUND. Callers pass `deleteInvoice.bind(null, id)`
 * from a server component: a server action reference is a legal prop
 * across the boundary, and binding it there means this file imports no
 * actions at all and cannot drift toward knowing what it is deleting.
 *
 * REFUSALS ARE NORMAL HERE, not exceptional, which is why the error is
 * rendered inside the dialog rather than as a toast. Three of the five
 * actions answer "no, and here is what is in the way" — a client with
 * trips, a tail on 40 logbook entries, an invoice already issued — and
 * that sentence is the most useful thing on the screen at that moment.
 */
export default function DeleteRecordButton({
  action,
  label,
  title,
  description,
  confirmLabel,
  redirectTo,
  variant = "outline",
  size,
}: {
  /** A server action, already bound to the row's id by the caller. */
  action: () => Promise<{ error: string | null }>;
  /** Text on the button that opens the dialog. */
  label: string;
  /** The dialog's question. */
  title: string;
  /** What deleting actually does, in the pilot's terms. */
  description: string;
  /** Text on the confirming button. Defaults to `label`. */
  confirmLabel?: string;
  /**
   * Where to go once it lands. Omitted when the record's own screen
   * survives the delete — removing a receipt leaves the expense page
   * perfectly valid, and pushing away from it would be a bug, not a
   * courtesy. The router.refresh() below is what updates it in place.
   */
  redirectTo?: string;
  /**
   * The opening button's look. Defaults to the outline used on a record's
   * own page; the fleet table passes quiet/sm so a per-row delete does not
   * outweigh the row it sits in.
   */
  variant?: "outline" | "quiet";
  size?: "sm";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);
      // The actions deliberately return instead of redirecting — they have
      // to, since they also have to be able to report a refusal back here —
      // so moving the pilot is this component's job.
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <LButton variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </LButton>
      <LConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // A refusal is about the attempt, not the record. Closing and
          // reopening must not re-present a stale sentence about a client
          // whose last trip the pilot has since deleted.
          if (!next) setError(null);
        }}
        title={title}
        description={
          <>
            <p>{description}</p>
            {error ? (
              <p className="mt-2 text-caption font-medium text-crit" role="alert">
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel={pending ? "Deleting…" : (confirmLabel ?? label)}
        confirmVariant="danger"
        onConfirm={confirmDelete}
        pending={pending}
      />
    </div>
  );
}
