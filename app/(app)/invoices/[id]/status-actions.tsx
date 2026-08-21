"use client";

import { useState, useTransition } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LConfirmDialog, LDialog } from "@/components/ledger/dialog";
import { LCheckbox, LField, LSelect, LTextarea } from "@/components/ledger/forms";
import { MAX_CUSTOM_MESSAGE_CHARS } from "@/lib/email/invoice-message";
import { sendInvoice, sendInvoiceReminder, voidInvoice, deleteInvoice } from "../actions";
import DeleteRecordButton from "@/components/delete-record-button";

type InvoiceForActions = {
  id: string;
  status: "draft" | "sent" | "partial" | "paid" | "void";
};

/**
 * Mirrors invoices_protect_issued's own forward-only transition table
 * exactly (draft -> sent|void, sent -> partial|paid|void, partial ->
 * paid|void) so a control is never shown for a move the database will
 * reject. That mirroring is a UX nicety, not the enforcement — every
 * action below still goes through the trigger regardless of what this
 * component renders.
 *
 * `canEmail` and `clientEmail` are resolved on the server and passed down,
 * because whether a send can work depends on environment variables this
 * client component must never see.
 */
/**
 * SHOWN ONLY WHEN THE NOTE IS ACTUALLY TOO LONG, and it exists because
 * `maxLength` was removed from both note boxes.
 *
 * `maxLength` looks like a guard and behaves like a saboteur: a browser
 * silently drops everything past the limit on paste — no event, no message,
 * and in a 3-row box the cut end is scrolled out of view — so a pilot sends
 * a note that stops mid-word believing it went out whole. Worse, it made
 * sendInvoice's length check UNREACHABLE from this screen, and that check
 * is not incidental: it runs BEFORE the status transition specifically so
 * an over-long note cannot leave an invoice issued, numbered and read-only
 * with the pilot's words dropped (see its comment). A control the product
 * bothered to order correctly should be reachable.
 *
 * So the limit is enforced where the server enforces it, and surfaced here
 * the moment it is crossed rather than as standing clutter — the note is
 * trimmed before counting, exactly as the server trims before checking, so
 * this never disagrees with the error a send would return.
 */
function NoteTooLong({ value }: { value: string }) {
  const over = value.trim().length - MAX_CUSTOM_MESSAGE_CHARS;
  if (over <= 0) return null;
  return (
    <p className="mt-1 text-caption font-medium text-crit">
      {over.toLocaleString()} character{over === 1 ? "" : "s"} over the{" "}
      {MAX_CUSTOM_MESSAGE_CHARS.toLocaleString()}-character limit. Shorten it.
      Nothing will be sent until you do.
    </p>
  );
}

export default function StatusActions({
  invoice,
  hasLines,
  canEmail,
  clientEmail,
  clientName,
  hasClient,
  receiptCount,
  hasInvoiceTemplate,
  automaticChase,
  hasDueDate,
}: {
  invoice: InvoiceForActions;
  hasLines: boolean;
  /** Mail service configured in this environment. */
  canEmail: boolean;
  /** The client's address on file, if any — the other half of "can we send". */
  clientEmail: string | null;
  clientName: string;
  /**
   * Whether this invoice bills a saved client (20260815100000). It changes
   * only WHERE a missing email is fixed: on the client's page, or in this
   * invoice's own bill-to block. Pointing a pilot at a client page for an
   * invoice that has no client is the kind of instruction that gets followed
   * for a minute before it is doubted.
   */
  hasClient: boolean;
  /**
   * Rebill lines whose expense has a receipt on file — resolved on the
   * server ([id]/page.tsx). 0 hides the receipts checkbox entirely; the
   * emailed PDF then simply has no receipt pages to argue about.
   */
  receiptCount: number;
  /**
   * Whether this account has SAVED an invoice opening line (Settings →
   * Message wording). False for every account that never opened that
   * panel, which is most of them — and the reason the dialog below cannot
   * say "your saved wording" flatly.
   */
  hasInvoiceTemplate: boolean;
  /**
   * What the schedule does for THIS invoice, in three states rather than two.
   *
   * The sentence under the reminder button exists to stay TRUE: it used to
   * read "nothing goes out automatically", a fact about the product until
   * 20260813130000 and now a fact about a particular client. A boolean could
   * not carry it, because the two reasons nothing goes out for this invoice
   * are claims at different scopes — "this client has no schedule" is about
   * the client, "you paused this one" is about the invoice, and saying the
   * first when the second is true tells a pilot none of that client's OTHER
   * invoices are chased when every one of them still is.
   *
   *   * "none"       — the client has no schedule at all.
   *   * "paused"     — the client has one; it is paused for this invoice only.
   *   * "live"       — it is live for this invoice.
   */
  automaticChase: "none" | "paused" | "live";
  /**
   * Whether this invoice has a due date. Paired with the flag above
   * because {{due_date}} is the one placeholder a perfectly valid saved
   * template can name and this invoice can fail to supply: applyTemplate
   * declines rather than printing a hole (lib/email/invoice-message.ts),
   * and the built-in wording goes out instead. Without this the dialog
   * would promise wording the send is about to decline.
   */
  hasDueDate: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  // Default ON: an invoice that rebills expenses normally travels with its
  // receipts, and this default matches the PDF download button's own
  // (pdf-download.tsx) so preview and send agree unless the pilot changes
  // one. CONTROLLED (checked + onChange) — this one sits inside an LDialog
  // rather than an action-dispatching form, but controlled is the house
  // shape for Ledger checkboxes so the analysis never has to be re-run
  // when the surroundings change.
  const [includeReceipts, setIncludeReceipts] = useState(true);

  // THE PER-SEND NOTE, one piece of state per dialog rather than one
  // shared. They are different messages to different ends — "here's the
  // bill for the KTEB trip" versus "any word on this one?" — and sharing
  // the state would carry the send note into the reminder box weeks later,
  // where the pilot would very plausibly not reread it before sending.
  //
  // CONTROLLED, per the checkbox note above: these sit inside an LDialog,
  // whose content unmounts on close exactly as Radix's AlertDialog did, so
  // an uncontrolled textarea would silently discard a half-written note if
  // the pilot closed the dialog to check something on the invoice. Held
  // here, above the dialog, it survives.
  const [sendNote, setSendNote] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  // The email option is only OFFERED when it can actually work. Both halves
  // matter and they fail for different reasons the pilot fixes in different
  // places, so they are reported separately below rather than as one
  // unhelpful "email unavailable".
  const emailReady = canEmail && Boolean(clientEmail);
  const [deliveryMethod, setDeliveryMethod] = useState<
    "platform_email" | "manual_download"
  >(emailReady ? "platform_email" : "manual_download");

  if (invoice.status === "paid" || invoice.status === "void") {
    return null;
  }

  const canSend = invoice.status === "draft";
  const canRemind = invoice.status === "sent" || invoice.status === "partial";
  // DRAFTS ARE DISCARDED, NOT VOIDED, and that is a change from what this
  // screen used to offer. Voiding a draft left a permanent "cancelled
  // invoice" in the list for a document that had no number, no payments and
  // no reader — the void existed to say "this numbered invoice is
  // cancelled", and a draft has nothing to say that about. Delete is the
  // honest operation and it is what canDiscard offers below.
  const canVoid = invoice.status === "sent" || invoice.status === "partial";
  const canDiscard = invoice.status === "draft";

  return (
    <LCard>
      <div className="mb-2 text-h3 font-semibold">Status</div>

      {canSend ? (
        <div className="mb-4">
          <div className="flex flex-col gap-1">
            <LField label="Delivery" htmlFor="delivery-method">
              <LSelect
                id="delivery-method"
                value={deliveryMethod}
                onChange={(e) =>
                  setDeliveryMethod(e.target.value as "platform_email" | "manual_download")
                }
              >
                {/* This option was removed in an earlier round with a note
                    saying to put it back the day a sender existed, because
                    offering it while nothing sent mail would let a pilot mark
                    a $14,000 invoice "Emailed from here", watch it lock
                    read-only and start ageing toward overdue, while the client
                    received nothing. lib/email/send.ts is that sender, and
                    sendInvoice now sends BEFORE it marks — so the option is
                    back, and still hidden whenever a send could not succeed. */}
                {emailReady ? (
                  <option value="platform_email">Email it to {clientName}</option>
                ) : null}
                <option value="manual_download">I&rsquo;ll send it myself</option>
              </LSelect>
            </LField>
          </div>

          {emailReady ? (
            <>
              <p className="mt-2 text-caption text-ink-3">
                Goes to {clientEmail} with the PDF attached.
              </p>
              {deliveryMethod === "platform_email" && receiptCount > 0 ? (
                <>
                  <label className="mt-2 flex items-center gap-1 text-caption text-ink-3">
                    <LCheckbox
                      checked={includeReceipts}
                      onChange={(e) => setIncludeReceipts(e.target.checked)}
                    />
                    Attach {receiptCount === 1 ? "the receipt" : `${receiptCount} receipts`} for
                    rebilled expenses
                  </label>
                  {/* THE SCOPE OF THAT CHECKBOX, STATED. It governs the PDF
                      on THIS email and nothing else: it is a per-send choice
                      that is stored nowhere, so it does not reach a later
                      reminder (which re-attaches the full document) and it
                      does not reach the client share link, which renders
                      receipt images from pilot.invoice_share_receipts
                      regardless. Unticking it to keep a receipt away from a
                      client, and being silently overridden on those two
                      surfaces, is the failure this sentence exists to
                      prevent; share-panel.tsx carries the other half. */}
                  <p className="mt-1 text-caption text-ink-3">
                    This email only. Reminders re-attach the full PDF, and a client
                    link shows {receiptCount === 1 ? "the receipt" : "receipts"} either
                    way.
                  </p>
                </>
              ) : null}
            </>
          ) : !canEmail ? (
            <p className="mt-2 text-caption text-ink-3">
              Emailing isn&rsquo;t set up on this account yet, so you&rsquo;ll need to
              download the PDF and send it yourself.
            </p>
          ) : (
            <p className="mt-2 text-caption text-ink-3">
              {hasClient
                ? `${clientName} has no email address on file. Add one on their page to send from here.`
                : `This invoice has no email address on it. Add one in the bill-to details to send from here.`}
            </p>
          )}

          {!hasLines ? (
            // Visible, not a title= on a disabled button: a disabled
            // button is not focusable, so a tooltip is unreachable by
            // keyboard and silent to assistive tech.
            <p className="mt-2 text-caption text-ink-3">Add at least one line before sending.</p>
          ) : null}

          <div className="mt-3">
            {/* THE ONE FILLED ACCENT ACTION on this page while the invoice
                is a draft — the status-advancing move a pilot opens this
                screen to make. Once sent, this control is gone and
                PaymentPanel's "Record payment" earns the same treatment
                instead (see its own note); the two states never overlap,
                so there is never more than one primary button on screen. */}
            <LButton
              type="button"
              disabled={pending || !hasLines}
              className="w-full"
              onClick={() => setSendOpen(true)}
            >
              {pending
                ? "Sending…"
                : deliveryMethod === "platform_email"
                  ? "Send to client"
                  : "Mark as sent"}
            </LButton>
            <LDialog
              open={sendOpen}
              onOpenChange={setSendOpen}
              title={
                deliveryMethod === "platform_email"
                  ? `Email this invoice to ${clientName}?`
                  : "Mark this invoice as sent?"
              }
              description={
                deliveryMethod === "platform_email"
                  ? `It goes to ${clientEmail} with the PDF attached, and becomes read-only except for status, notes, and delivery. This can't be undone. Use "Preview PDF" above to see exactly what they'll get first.`
                  : "It becomes read-only except for status, notes, and delivery, and gets its permanent invoice number. This can't be undone. Use \"Preview PDF\" above to see exactly what the client will get before you send it."
              }
              footer={
                <>
                  <LButton
                    type="button"
                    variant="quiet"
                    onClick={() => setSendOpen(false)}
                  >
                    Cancel
                  </LButton>
                  <LButton
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      // Closes the instant it's pressed, exactly as Radix's
                      // AlertDialog.Action always did — not gated on the
                      // async result. The error/success sentence below
                      // renders in the main panel, after the dialog is
                      // already gone.
                      setSendOpen(false);
                      startTransition(async () => {
                        setError(null);
                        setSentNote(null);
                        const result = await sendInvoice(
                          invoice.id,
                          deliveryMethod,
                          // Only meaningful on the email path; the
                          // manual path attaches nothing.
                          deliveryMethod === "platform_email" ? includeReceipts : true,
                          // Same reasoning: the manual path sends no
                          // mail, so it must not carry a message that
                          // would go nowhere.
                          deliveryMethod === "platform_email" ? sendNote : null
                        );
                        setError(result?.error ?? null);
                        // Kept on failure so the pilot can fix the
                        // problem and send without retyping; cleared on
                        // success so the box is not pre-loaded with an
                        // old note if this component re-renders.
                        if (!result?.error) setSendNote("");
                      });
                    }}
                  >
                    {deliveryMethod === "platform_email" ? "Send it" : "Mark as sent"}
                  </LButton>
                </>
              }
            >
              {/* OFFERED ONLY ON THE EMAIL PATH. "I'll send it myself"
                  sends no mail at all, so a message box there would take
                  a pilot's words and drop them — the silent-failure shape
                  this whole action was rewritten to stop. */}
              {deliveryMethod === "platform_email" ? (
                <div>
                  <LField label="Add a message (optional)" htmlFor="send-note">
                    {/* NO maxLength — see NoteTooLong below. */}
                    <LTextarea
                      id="send-note"
                      rows={3}
                      value={sendNote}
                      onChange={(event) => setSendNote(event.target.value)}
                      placeholder={`Anything ${clientName} should know about this one`}
                    />
                  </LField>
                  <NoteTooLong value={sendNote} />
                  {/* NAMES THE OPENING LINE THIS SEND WILL ACTUALLY USE.
                      The flat "your saved wording" this replaced was wrong
                      twice over: it referred to something that does not
                      exist for an account that never opened Settings →
                      Message wording, and it promised a saved template
                      even on the invoices where applyTemplate declines it.
                      The declining case is exactly one in practice — a
                      template naming {{due_date}} on an invoice with no due
                      date — so it is stated as that case rather than as a
                      general caveat a pilot could not act on. */}
                  <p className="mt-1 text-caption text-ink-3">
                    Goes in this email only.{" "}
                    {!hasInvoiceTemplate
                      ? "The standard opening line, the amount due and the PDF are sent as usual."
                      : hasDueDate
                        ? "Your saved opening line, the amount due and the PDF are sent as usual."
                        : "Your saved opening line is used unless it mentions a due date. This invoice hasn’t got one, and the standard wording is sent instead. The amount due and the PDF go as usual."}
                  </p>
                </div>
              ) : null}
            </LDialog>
          </div>
        </div>
      ) : null}

      {/* CHASING AN INVOICE THAT IS ALREADY OUT. Deliberately manual: the
          pilot decides when to nudge their own client. This product will not
          send mail on a schedule to someone else's customer on their behalf —
          a badly-timed automatic chase costs a contract pilot the next
          booking, and they would have no idea it went out. */}
      {canRemind ? (
        <div className="mb-4">
          {emailReady ? (
            <>
              <LButton
                type="button"
                variant="outline"
                className="w-full"
                disabled={pending}
                onClick={() => setReminderOpen(true)}
              >
                {pending ? "Sending…" : "Send a reminder"}
              </LButton>
              <LDialog
                open={reminderOpen}
                onOpenChange={setReminderOpen}
                title={`Send a reminder to ${clientName}?`}
                description={
                  <>
                    A short follow-up goes to {clientEmail} with the invoice attached
                    again
                    {receiptCount > 0
                      ? `, including ${
                          receiptCount === 1
                            ? "the receipt"
                            : `all ${receiptCount} receipts`
                        } for rebilled expenses`
                      : ""}
                    . It doesn&rsquo;t change the invoice or add any late fee.
                  </>
                }
                footer={
                  <>
                    <LButton
                      type="button"
                      variant="quiet"
                      onClick={() => setReminderOpen(false)}
                    >
                      Cancel
                    </LButton>
                    <LButton
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        // Same always-closes-on-click shape as the send
                        // dialog above — see its own comment.
                        setReminderOpen(false);
                        startTransition(async () => {
                          setError(null);
                          setSentNote(null);
                          const result = await sendInvoiceReminder(invoice.id, reminderNote);
                          setError(result?.error ?? null);
                          if (!result?.error) {
                            setSentNote(`Reminder sent to ${clientEmail}.`);
                            setReminderNote("");
                          }
                        });
                      }}
                    >
                      Send reminder
                    </LButton>
                  </>
                }
              >
                <div>
                  <LField label="Add a message (optional)" htmlFor="reminder-note">
                    {/* NO maxLength — see NoteTooLong below. */}
                    <LTextarea
                      id="reminder-note"
                      rows={3}
                      value={reminderNote}
                      onChange={(event) => setReminderNote(event.target.value)}
                      placeholder="Anything to add to this reminder"
                    />
                  </LField>
                  <NoteTooLong value={reminderNote} />
                  <p className="mt-1 text-caption text-ink-3">Goes in this reminder only.</p>
                </div>
              </LDialog>
              <p className="mt-2 text-caption text-ink-3">
                {automaticChase === "live"
                  ? "Reminders for this client also go out on their own. See the Reminders panel below for what is scheduled, and to pause it for this invoice."
                  : automaticChase === "paused"
                    ? `Automatic reminders are paused for this invoice, so chasing it is up to you. ${clientName}’s other open invoices are still chased on their schedule. See the Reminders panel below.`
                    : hasClient
                      ? "You choose when to chase. Nothing goes out automatically for this client."
                      : "You choose when to chase. Scheduled reminders follow a client's schedule, and this invoice has no client, so nothing goes out for it on its own."}
              </p>
            </>
          ) : (
            <p className="text-caption text-ink-3">
              {canEmail
                ? hasClient
                  ? `${clientName} has no email address on file, so reminders can’t be sent from here.`
                  : "This invoice has no email address on it, so reminders can’t be sent from here."
                : "Emailing isn’t set up on this account yet, so reminders can’t be sent from here."}
            </p>
          )}
        </div>
      ) : null}

      {canVoid ? (
        <>
          <LButton
            type="button"
            variant="outline"
            className="w-full text-crit hover:text-crit"
            disabled={pending}
            onClick={() => setVoidOpen(true)}
          >
            {pending ? "Working…" : "Void invoice"}
          </LButton>
          <LConfirmDialog
            open={voidOpen}
            onOpenChange={setVoidOpen}
            title="Void this invoice?"
            description="This can’t be undone."
            confirmLabel="Void invoice"
            confirmVariant="danger"
            pending={pending}
            onConfirm={() => {
              // Same always-closes-on-click shape as the two dialogs
              // above.
              setVoidOpen(false);
              startTransition(async () => {
                setError(null);
                setSentNote(null);
                const result = await voidInvoice(invoice.id);
                setError(result?.error ?? null);
              });
            }}
          />
        </>
      ) : null}

      {canDiscard ? (
        <DeleteRecordButton
          action={deleteInvoice.bind(null, invoice.id)}
          label="Discard draft"
          title="Discard this draft?"
          description="It has no number and nobody has seen it, so nothing is left on the record. Its lines are released, so the trip and any rebilled expenses can be invoiced again. This can’t be undone."
          confirmLabel="Discard draft"
          redirectTo="/invoices"
        />
      ) : null}

      {error ? (
        <div className="mt-3" role="alert">
          <p className="text-caption font-medium text-crit">{error}</p>
        </div>
      ) : null}

      {sentNote ? (
        <div className="mt-3" role="status">
          <p className="text-caption font-medium text-good">{sentNote}</p>
        </div>
      ) : null}
    </LCard>
  );
}
