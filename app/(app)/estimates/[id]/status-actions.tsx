"use client";

import { useState, useTransition } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import {
  convertEstimateToInvoice,
  deleteEstimateDraft,
  markEstimateAccepted,
  markEstimateDeclined,
  markEstimateSent,
  reviseEstimate,
} from "../actions";
import { canTransition, type EstimateStatus } from "../estimate-lib";

type EstimateForActions = {
  id: string;
  status: EstimateStatus;
  estimate_number: string | null;
  converted_invoice_id: string | null;
};

/**
 * Mirrors pilot.estimates_protect's transition table exactly (via
 * canTransition, which is tested against the migration's own rules):
 * draft -> sent, sent -> accepted|declined|draft, declined -> sent|accepted.
 * The mirroring is a UX nicety, not the enforcement — every action below
 * still goes through the trigger regardless of what this renders.
 *
 * Conversion is not a transition: an accepted estimate stays accepted and
 * pilot.estimate_convert_to_invoice stamps converted_invoice_id, after
 * which the whole quote is frozen.
 *
 * THE PAGE'S ONE FILLED ACCENT ACTION lives here: whichever of "Mark as
 * sent" / "Mark accepted" / "Convert to invoice" is live for the current
 * status — the workflow-progressing move the detail screen exists to
 * drive, same reasoning as Overview reserving its fill for the screen's
 * headline action. The transition table above already keeps these
 * mutually exclusive by status, one filled button per render; every other
 * button on the detail page (header Save, line Save/Add, Email, Create
 * link) is outline, and every destructive one (Mark declined, Delete
 * draft) is outline tinted crit rather than filled.
 */
export default function StatusActions({
  estimate,
  hasLines,
  expiredDays,
  clientName,
}: {
  estimate: EstimateForActions;
  hasLines: boolean;
  /** Days past valid_until, from pilot.estimates_expired — null when not expired. */
  expiredDays: number | null;
  clientName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const converted = estimate.converted_invoice_id !== null;

  function run(action: (id: string) => Promise<{ error: string | null }>, doneNote?: string) {
    startTransition(async () => {
      setError(null);
      setNote(null);
      const result = await action(estimate.id);
      setError(result?.error ?? null);
      if (!result?.error && doneNote) setNote(doneNote);
    });
  }

  // A converted estimate has nothing left to drive — the page's banner
  // links to the invoice, which is where changes happen now.
  if (converted) {
    return (
      <LCard>
        <p className="mb-2 text-lead font-bold text-ink">Status</p>
        <p className="text-body-s text-ink-2">
          Accepted and converted to an invoice. This estimate is frozen. Its
          figures are the basis of that document.
        </p>
      </LCard>
    );
  }

  const canSend = canTransition(estimate.status, "sent");
  const canAccept = canTransition(estimate.status, "accepted");
  const canDecline = canTransition(estimate.status, "declined");
  const canRevise = canTransition(estimate.status, "draft");
  const canConvert = estimate.status === "accepted";
  // The RLS delete policy only lets an unnumbered, never-converted draft
  // go — a revised estimate is back in draft but keeps its number, and
  // keeps its record.
  const canDelete = estimate.status === "draft" && estimate.estimate_number === null;

  return (
    <LCard>
      <p className="mb-2 text-lead font-bold text-ink">Status</p>

      {expiredDays !== null ? (
        <p className="mb-3 text-caption text-warn">
          The valid-until date passed {expiredDays === 1 ? "1 day" : `${expiredDays} days`} ago.
          The quoted price no longer stands on its own. Revise and re-send it,
          or record the client&rsquo;s answer if they gave one in time.
        </p>
      ) : null}

      {canSend ? (
        <div className="mb-4">
          {estimate.status === "draft" ? (
            <>
              {!hasLines ? (
                // Visible, not a title= on a disabled button — a disabled
                // button is not focusable, so a tooltip there is silent to
                // keyboards and assistive tech.
                <p className="mb-2 text-caption text-ink-3">
                  Add at least one line before sending. A quote with nothing on
                  it totals $0.00.
                </p>
              ) : null}
              <LButton
                className="w-full"
                disabled={pending || !hasLines}
                onClick={() => setSendConfirmOpen(true)}
              >
                {pending ? "Working…" : "Mark as sent"}
              </LButton>
              <LConfirmDialog
                open={sendConfirmOpen}
                onOpenChange={setSendConfirmOpen}
                title="Mark this estimate as sent?"
                description={
                  estimate.estimate_number
                    ? `It keeps its number ${estimate.estimate_number} and moves back to Sent, waiting on ${clientName}'s answer.`
                    : `It gets its permanent estimate number and today's date. Nothing is emailed from here. You send the quote to ${clientName} yourself. You can still revise and re-send it afterwards.`
                }
                confirmLabel="Mark as sent"
                confirmVariant="primary"
                onConfirm={() => {
                  setSendConfirmOpen(false);
                  run(markEstimateSent);
                }}
              />
            </>
          ) : (
            // declined -> sent: the client said no, the conversation
            // reopened. Number and record survive.
            <LButton
              variant="outline"
              className="w-full"
              disabled={pending}
              onClick={() => run(markEstimateSent, "Back out as a live quote.")}
            >
              {pending ? "Working…" : "Send it again"}
            </LButton>
          )}
        </div>
      ) : null}

      {canAccept || canDecline ? (
        <div className="mb-4">
          <p className="mb-2 text-caption text-ink-3">Record {clientName}&rsquo;s answer:</p>
          <div className="flex flex-col gap-2">
            {canAccept ? (
              <LButton disabled={pending} onClick={() => run(markEstimateAccepted, "Marked accepted.")}>
                {pending ? "Working…" : "Mark accepted"}
              </LButton>
            ) : null}
            {canDecline ? (
              <LButton
                variant="outline"
                className="border-crit text-crit hover:bg-crit-soft"
                disabled={pending}
                onClick={() => run(markEstimateDeclined, "Marked declined.")}
              >
                {pending ? "Working…" : "Mark declined"}
              </LButton>
            ) : null}
          </div>
        </div>
      ) : null}

      {canRevise ? (
        <div className="mb-4">
          <LButton
            variant="outline"
            className="w-full"
            disabled={pending}
            onClick={() => run(reviseEstimate, "Back in draft. Edit and re-send.")}
          >
            {pending ? "Working…" : "Revise"}
          </LButton>
          <p className="mt-2 text-caption text-ink-3">
            Takes it back to draft to change lines or terms, then re-send. It
            keeps its number.
          </p>
        </div>
      ) : null}

      {canConvert ? (
        <div className="mb-4">
          {!hasLines ? (
            <p className="mb-2 text-caption text-ink-3">
              This estimate has no lines, so there&rsquo;s nothing to put on an
              invoice.
            </p>
          ) : null}
          <LButton
            className="w-full"
            disabled={pending || !hasLines}
            onClick={() => setConvertConfirmOpen(true)}
          >
            {pending ? "Converting…" : "Convert to invoice"}
          </LButton>
          <LConfirmDialog
            open={convertConfirmOpen}
            onOpenChange={setConvertConfirmOpen}
            title="Convert this estimate to an invoice?"
            description={
              <>
                Creates a draft invoice carrying every line and the tax rate as
                quoted. You still review and send that invoice; nothing goes to{" "}
                {clientName} now. Afterwards this estimate is frozen and can&rsquo;t
                convert a second time.
              </>
            }
            confirmLabel="Convert"
            confirmVariant="primary"
            onConfirm={() => {
              setConvertConfirmOpen(false);
              run(convertEstimateToInvoice);
            }}
          />
        </div>
      ) : null}

      {canDelete ? (
        <>
          <LButton
            variant="outline"
            className="w-full border-crit text-crit hover:bg-crit-soft"
            disabled={pending}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            {pending ? "Working…" : "Delete draft"}
          </LButton>
          <LConfirmDialog
            open={deleteConfirmOpen}
            onOpenChange={setDeleteConfirmOpen}
            title="Delete this draft estimate?"
            description="It was never sent, so nothing references it. This can't be undone."
            confirmLabel="Delete draft"
            confirmVariant="danger"
            onConfirm={() => {
              setDeleteConfirmOpen(false);
              run(deleteEstimateDraft);
            }}
          />
        </>
      ) : null}

      {estimate.status === "draft" && estimate.estimate_number !== null ? (
        <p className="mt-3 text-caption text-ink-3">
          This estimate has been sent before, so it keeps its number and its
          record. It can&rsquo;t be deleted, only revised and re-sent.
        </p>
      ) : null}

      {error ? (
        <div className="mt-3" role="alert">
          <p className="text-caption text-crit">{error}</p>
        </div>
      ) : null}

      {note ? (
        <div className="mt-3" role="status">
          <p className="text-caption text-good">{note}</p>
        </div>
      ) : null}
    </LCard>
  );
}
