"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { LInput } from "@/components/ledger/forms";
import { formatDate } from "@/lib/format";
import { createEstimateShare, revokeEstimateShare, type EstimateShareState } from "../share-actions";

/**
 * "Share with client" — mirrors app/(app)/invoices/[id]/share-panel.tsx's
 * shape closely (create/rotate/revoke, the same "Viewed" honesty), minus
 * the receipts sentence, which has no estimate equivalent. The one
 * addition invoices don't have: this link lets the client record their own
 * accept/decline directly (pilot.estimate_public_accept/_decline,
 * 20260814111000) — said here explicitly, for the same reason share-
 * panel.tsx's receipts sentence exists on the invoice side: a pilot must
 * know what a link they are about to hand over can DO, not just what it
 * shows.
 *
 * Only rendered for a non-draft estimate ([id]/page.tsx) — draft never
 * reaches this component, matching pilot.estimate_share_create's own
 * status gate.
 */

const initialState: EstimateShareState = { error: null };

export type EstimateShareRow = {
  token: string;
  revoked_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
} | null;

export default function SharePanel({
  estimateId,
  share,
}: {
  estimateId: string;
  share: EstimateShareRow;
}) {
  const [createState, createAction, creating] = useActionState(createEstimateShare, initialState);
  const [revokeState, revokeAction, revoking] = useActionState(revokeEstimateShare, initialState);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  // The confirm dialogs below don't own a submit button of their own — they
  // trigger these hidden forms via requestSubmit(), the same real form
  // submission a visible submit button would fire, so createAction/
  // revokeAction (React 19 form actions) dispatch through the exact
  // mechanism every other action-bound form in this product uses rather
  // than being called as plain functions.
  const createFormRef = useRef<HTMLFormElement>(null);
  const revokeFormRef = useRef<HTMLFormElement>(null);

  const liveToken = createState.token ?? (share && !share.revoked_at ? share.token : null);

  const viewed =
    liveToken && share && !share.revoked_at && share.token === liveToken
      ? share.last_viewed_at
      : null;
  const firstViewed =
    liveToken && share && !share.revoked_at && share.token === liveToken
      ? share.first_viewed_at
      : null;

  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const shareUrl = liveToken && origin ? `${origin}/estimate/${liveToken}` : null;

  const pending = creating || revoking;
  const error = createState.error ?? revokeState.error;

  return (
    <LCard>
      <p className="mb-2 text-lead font-bold text-ink">Share with client</p>
      <p className="mb-3 text-caption text-ink-3">
        A link your client can open without an account: the quote, its status,
        and buttons to accept or decline it, if it&rsquo;s still awaiting an
        answer. You send it; nothing here emails it for you.
      </p>

      {shareUrl ? (
        <div className="flex w-full flex-col gap-2">
          <LInput readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          <p className="text-caption text-ink-3">
            {viewed
              ? `Viewed ${formatDate(viewed)}${
                  firstViewed && formatDate(firstViewed) !== formatDate(viewed)
                    ? ` · first opened ${formatDate(firstViewed)}`
                    : ""
                }. Opening counts even if it was an email scanner, not your client.`
              : "Not viewed yet."}
          </p>
          <div className="flex gap-2">
            {/* Outline, not filled — the detail page's one accent action is
                StatusActions' live CTA. */}
            <LButton
              type="button"
              variant="outline"
              className="w-full flex-1"
              disabled={pending}
              onClick={() => setReplaceConfirmOpen(true)}
            >
              {creating ? "Rotating…" : "Generate a new link"}
            </LButton>
            <LConfirmDialog
              open={replaceConfirmOpen}
              onOpenChange={setReplaceConfirmOpen}
              title="Replace this client link?"
              description="The link you already sent stops working immediately. If your client has it bookmarked or in their inbox, it will 404 for them. You'll get a new link to send instead."
              confirmLabel="Replace it"
              cancelLabel="Keep the current link"
              confirmVariant="primary"
              onConfirm={() => {
                setReplaceConfirmOpen(false);
                createFormRef.current?.requestSubmit();
              }}
            />
            <LButton
              type="button"
              variant="outline"
              className="border-crit text-crit hover:bg-crit-soft"
              disabled={pending}
              onClick={() => setRevokeConfirmOpen(true)}
            >
              Revoke
            </LButton>
            <LConfirmDialog
              open={revokeConfirmOpen}
              onOpenChange={setRevokeConfirmOpen}
              title="Revoke this client link?"
              description="The link stops working immediately. If your client has it bookmarked or in their email, it will 404 for them. Generate a new one if they still need access."
              confirmLabel="Revoke"
              confirmVariant="danger"
              onConfirm={() => {
                setRevokeConfirmOpen(false);
                revokeFormRef.current?.requestSubmit();
              }}
            />
          </div>
          {/* Hidden forms the two dialogs above submit via requestSubmit(). */}
          <form ref={createFormRef} action={createAction} className="hidden">
            <input type="hidden" name="estimate_id" value={estimateId} />
          </form>
          <form ref={revokeFormRef} action={revokeAction} className="hidden">
            <input type="hidden" name="estimate_id" value={estimateId} />
          </form>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          {share?.revoked_at ? (
            <p className="text-caption text-ink-3">The previous link was revoked.</p>
          ) : null}
          <form action={createAction}>
            <input type="hidden" name="estimate_id" value={estimateId} />
            {/* Outline, not filled — see the header comment above. */}
            <LButton type="submit" variant="outline" disabled={pending}>
              {creating ? "Creating…" : "Create client link"}
            </LButton>
          </form>
        </div>
      )}

      {error ? (
        <p className="mt-2 text-caption text-crit" role="alert">
          {error}
        </p>
      ) : null}
    </LCard>
  );
}
