"use client";

import { useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { deleteTrip } from "../actions";

/**
 * Delete, not archive — a trip has no archived state, and an
 * accidentally-logged trip should leave nothing behind. Disabled once the
 * trip has been invoiced: the invoice's lines reference it, and Phase 5's
 * triggers refuse to let billed work vanish out from under a document
 * that has already gone to a client.
 */
export default function DeleteTripButton({
  id,
  disabled,
}: {
  id: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    startTransition(async () => {
      // A successful delete redirects and never returns, so anything
      // that comes back is a failure worth showing. On failure we keep
      // the dialog open (rather than closing it and disabling the
      // trigger) so keyboard focus stays on the still-enabled confirm
      // button instead of falling back to <body>.
      const result = await deleteTrip(id);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end">
      <LButton
        type="button"
        variant="outline"
        disabled={disabled}
        title={disabled ? "This trip has been invoiced and can't be deleted." : undefined}
        onClick={() => setOpen(true)}
      >
        Delete trip
      </LButton>
      <LConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this trip?"
        description={
          <>
            This deletes the trip, its legs, and its day grid. The billing
            record goes with it. Expenses filed against it stay in your
            expense list but lose their trip link. This can&rsquo;t be
            undone.
            {error ? (
              <p className="mt-2 text-caption font-medium text-crit" role="alert">
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete trip"
        onConfirm={handleDelete}
        pending={pending}
      />
    </div>
  );
}
