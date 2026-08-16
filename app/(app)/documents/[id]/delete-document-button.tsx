"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { deleteDocument } from "../actions";

export default function DeleteDocumentButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function doDelete() {
    // Closes the instant it's pressed — the same always-closes-on-click
    // shape invoices/[id]/status-actions.tsx's void-invoice dialog keeps;
    // the error line renders below the button, after the dialog is gone,
    // rather than holding the dialog open.
    setOpen(false);
    startTransition(async () => {
      const result = await deleteDocument(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      // The action doesn't redirect — it can't, since it also has to
      // report a failure back here — so navigation is this component's
      // job once the delete lands.
      router.push("/documents");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <LButton
        type="button"
        variant="outline"
        className="text-crit hover:text-crit"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        {pending ? "Deleting…" : "Delete document"}
      </LButton>
      <LConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this document?"
        description="This deletes the document and its attached file. This can’t be undone."
        confirmLabel="Delete document"
        confirmVariant="danger"
        pending={pending}
        onConfirm={doDelete}
      />
      {error ? (
        <p className="text-caption font-medium text-crit" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
