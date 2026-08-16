"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LButton } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { acceptPublicEstimate, declinePublicEstimate } from "./respond-actions";

/**
 * "Accept" / "Decline" — only rendered while the estimate's status is
 * 'sent' (page.tsx), matching pilot.estimate_public_accept/_decline's own
 * gate exactly, so this control is never shown where the RPC would no-op.
 *
 * router.refresh() after either action, rather than trusting a client-side
 * status flip: the RPC is a silent no-op on a stale or already-answered
 * token (see respond-actions.ts's own header), so the honest thing is to
 * re-fetch pilot.estimate_public and show whatever the real row now says —
 * never to optimistically claim "Accepted" for a click that may have done
 * nothing.
 *
 * LConfirmDialog on native <dialog>, replacing the old AlertDialog pair —
 * same two-step shape (a trigger button, a confirm/cancel dialog), and the
 * same close-then-run order Radix's AlertDialog.Action gave for free: the
 * dialog closes the instant "Accept"/"Decline" is confirmed, and `pending`
 * plays out on the ORIGINAL trigger button underneath (its own
 * "Working…" label) rather than inside a dialog that has already gone.
 *
 * Accept is Ledger's one filled-accent action for this view (LEDGER.md's
 * "one filled accent action per view"), matching this page's own positive
 * default; Decline stays outline, and only steps up to `danger` at the
 * point of actual commitment — the confirm button inside its own dialog —
 * not on the trigger a client might tap by accident.
 */
export default function RespondPanel({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"accept" | "decline" | null>(null);

  function respond(action: (token: string) => Promise<{ error: string | null }>) {
    setConfirming(null);
    startTransition(async () => {
      setError(null);
      const result = await action(token);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <LButton
          size="lg"
          className="flex-1"
          disabled={pending}
          onClick={() => setConfirming("accept")}
        >
          {pending ? "Working…" : "Accept this quote"}
        </LButton>
        <LButton
          size="lg"
          variant="outline"
          className="flex-1"
          disabled={pending}
          onClick={() => setConfirming("decline")}
        >
          Decline
        </LButton>
      </div>
      {error ? (
        <p role="alert" className="text-caption font-medium text-crit">
          {error}
        </p>
      ) : null}

      <LConfirmDialog
        open={confirming === "accept"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Accept this quote?"
        description="Your pilot will see this as accepted and can turn it into an invoice for the work. This doesn't charge you anything now."
        confirmLabel="Accept"
        confirmVariant="primary"
        pending={pending}
        onConfirm={() => respond(acceptPublicEstimate)}
      />
      <LConfirmDialog
        open={confirming === "decline"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Decline this quote?"
        description="Your pilot will see this as declined. If you change your mind, ask them to send it again."
        confirmLabel="Decline"
        confirmVariant="danger"
        pending={pending}
        onConfirm={() => respond(declinePublicEstimate)}
      />
    </div>
  );
}
