"use client";

import { useState, useTransition } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { LField, LTextarea } from "@/components/ledger/forms";
import { MAX_CUSTOM_MESSAGE_CHARS } from "@/lib/email/invoice-message";
import { sendEstimate } from "../actions";

/**
 * "Email this estimate" — the client-facing send, distinct from "Mark as
 * sent" (status-actions.tsx), which only records that the pilot quoted the
 * client some other way. This is the surface that actually puts the PDF in
 * an inbox, mirroring invoices' StatusActions "Send a reminder" dialog:
 * same confirmation, same controlled per-send note, same "Goes to {email}"
 * honesty so a pilot never confirms a send without knowing which inbox it
 * reaches.
 *
 * Only rendered for a non-draft estimate ([id]/page.tsx) — a draft has no
 * permanent number yet and sendEstimate itself refuses one regardless of
 * what this component shows.
 */
function NoteTooLong({ value }: { value: string }) {
  const over = value.trim().length - MAX_CUSTOM_MESSAGE_CHARS;
  if (over <= 0) return null;
  return (
    <p className="mt-1 text-caption text-crit">
      {over.toLocaleString()} character{over === 1 ? "" : "s"} over the{" "}
      {MAX_CUSTOM_MESSAGE_CHARS.toLocaleString()}-character limit. Shorten it.
      Nothing will be sent until you do.
    </p>
  );
}

export default function SendPanel({
  estimateId,
  canEmail,
  clientEmail,
  clientName,
}: {
  estimateId: string;
  /** Mail service configured in this environment. */
  canEmail: boolean;
  /** The client's address on file, if any — the other half of "can we send". */
  clientEmail: string | null;
  clientName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const emailReady = canEmail && Boolean(clientEmail);
  const noteTooLong = note.trim().length > MAX_CUSTOM_MESSAGE_CHARS;

  return (
    <LCard>
      <p className="mb-2 text-lead font-bold text-ink">Email this quote</p>

      {emailReady ? (
        <>
          <p className="mb-3 text-caption text-ink-3">
            Goes to {clientEmail} with the PDF attached. You can send it again any
            time. This doesn&rsquo;t change the estimate or its status.
          </p>
          {/* Outline, not filled — the detail page's one accent action is
              StatusActions' live CTA. */}
          <LButton variant="outline" className="w-full" disabled={pending} onClick={() => setConfirmOpen(true)}>
            {pending ? "Sending…" : `Email it to ${clientName}`}
          </LButton>
          <LConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={`Email this quote to ${clientName}?`}
            confirmLabel="Send it"
            confirmVariant="primary"
            description={
              <div className="flex flex-col gap-3">
                <p>
                  It goes to {clientEmail} with the PDF attached, marked as an
                  estimate. No payment is requested. Use &ldquo;Preview PDF&rdquo;
                  above to see exactly what they&rsquo;ll get first.
                </p>
                <LField label="Add a message (optional)" htmlFor="estimate-send-note">
                  {/* NO maxLength — see NoteTooLong above, same reasoning as
                      status-actions.tsx: a silently truncated paste is worse
                      than a visible over-length warning. */}
                  <LTextarea
                    id="estimate-send-note"
                    rows={3}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={`Anything ${clientName} should know about this quote`}
                  />
                </LField>
                <NoteTooLong value={note} />
                <p className="text-caption text-ink-3">
                  Goes in this email only. The estimate total and the PDF are
                  sent as usual.
                </p>
              </div>
            }
            onConfirm={() => {
              if (noteTooLong) return;
              setConfirmOpen(false);
              startTransition(async () => {
                setError(null);
                setSentNote(null);
                const result = await sendEstimate(estimateId, note);
                setError(result?.error ?? null);
                if (!result?.error) {
                  setSentNote(`Sent to ${clientEmail}.`);
                  setNote("");
                }
              });
            }}
          />
        </>
      ) : !canEmail ? (
        <p className="text-caption text-ink-3">
          Emailing isn&rsquo;t set up on this account yet, so you&rsquo;ll need to
          download the PDF and send it yourself.
        </p>
      ) : (
        <p className="text-caption text-ink-3">
          {clientName} has no email address on file. Add one on their page to
          send from here.
        </p>
      )}

      {error ? (
        <div className="mt-3" role="alert">
          <p className="text-caption text-crit">{error}</p>
        </div>
      ) : null}

      {sentNote ? (
        <div className="mt-3" role="status">
          <p className="text-caption text-good">{sentNote}</p>
        </div>
      ) : null}
    </LCard>
  );
}
