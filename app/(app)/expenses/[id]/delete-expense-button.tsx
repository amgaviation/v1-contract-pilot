"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { deleteExpense } from "../actions";

export default function DeleteExpenseButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    startTransition(async () => {
      const result = await deleteExpense(id);
      if (result.error) {
        // Keep the dialog open on failure so focus stays on the still-
        // enabled confirm button instead of falling back to <body>.
        setError(result.error);
        return;
      }
      // The action doesn't redirect — it can't, since it also has to
      // report a failure back here — so navigation is this component's
      // job once the delete lands.
      router.push("/expenses");
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <LButton variant="outline" onClick={() => setOpen(true)}>
        Delete expense
      </LButton>
      <LConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this expense?"
        description={
          <>
            <p>This removes the expense and its receipt. This can&rsquo;t be undone.</p>
            {error ? (
              <p className="mt-2 text-caption font-medium text-crit" role="alert">
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete expense"
        confirmVariant="danger"
        onConfirm={confirmDelete}
        pending={pending}
      />
    </div>
  );
}
