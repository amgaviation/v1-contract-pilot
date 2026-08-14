"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Select,
  Text,
  TextArea,
} from "@/components/ui";
import { MAX_CUSTOM_MESSAGE_CHARS } from "@/lib/email/invoice-message";
import { sendInvoice, sendInvoiceReminder, voidInvoice } from "../actions";

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
    <Text as="div" size="1" color="red" mt="1">
      {over.toLocaleString()} character{over === 1 ? "" : "s"} over the{" "}
      {MAX_CUSTOM_MESSAGE_CHARS.toLocaleString()}-character limit. Shorten it,
      nothing will be sent until you do.
    </Text>
  );
}

export default function StatusActions({
  invoice,
  hasLines,
  canEmail,
  clientEmail,
  clientName,
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
  // one. CONTROLLED (checked + onCheckedChange), per the React-19
  // reset-event analysis in lines-editor.tsx — this one sits inside an
  // AlertDialog rather than an action-dispatching form, but controlled is
  // the house shape for Radix checkboxes so the analysis never has to be
  // re-run when the surroundings change.
  const [includeReceipts, setIncludeReceipts] = useState(true);

  // THE PER-SEND NOTE, one piece of state per dialog rather than one
  // shared. They are different messages to different ends — "here's the
  // bill for the KTEB trip" versus "any word on this one?" — and sharing
  // the state would carry the send note into the reminder box weeks later,
  // where the pilot would very plausibly not reread it before sending.
  //
  // CONTROLLED, per the React-19 note on the checkbox above: these sit
  // inside an AlertDialog, whose content Radix unmounts on close, so an
  // uncontrolled TextArea would silently discard a half-written note if
  // the pilot closed the dialog to check something on the invoice. Held
  // here, above the dialog, it survives.
  const [sendNote, setSendNote] = useState("");
  const [reminderNote, setReminderNote] = useState("");

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
  const canVoid =
    invoice.status === "draft" || invoice.status === "sent" || invoice.status === "partial";

  return (
    <Card size="3">
      <Text as="div" size="4" weight="bold" mb="2">
        Status
      </Text>

      {canSend ? (
        <Box mb="4">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id="delivery-method-label">
              Delivery
            </Text>
            <Select.Root
              value={deliveryMethod}
              onValueChange={(value) =>
                setDeliveryMethod(value as "platform_email" | "manual_download")
              }
            >
              <Select.Trigger aria-labelledby="delivery-method-label" />
              <Select.Content>
                {/* This option was removed in an earlier round with a note
                    saying to put it back the day a sender existed, because
                    offering it while nothing sent mail would let a pilot mark
                    a $14,000 invoice "Emailed from here", watch it lock
                    read-only and start ageing toward overdue, while the client
                    received nothing. lib/email/send.ts is that sender, and
                    sendInvoice now sends BEFORE it marks — so the option is
                    back, and still hidden whenever a send could not succeed. */}
                {emailReady ? (
                  <Select.Item value="platform_email">
                    Email it to {clientName}
                  </Select.Item>
                ) : null}
                <Select.Item value="manual_download">I&rsquo;ll send it myself</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>

          {emailReady ? (
            <>
              <Text as="div" size="1" color="gray" mt="2">
                Goes to {clientEmail} with the PDF attached.
              </Text>
              {deliveryMethod === "platform_email" && receiptCount > 0 ? (
                <>
                  <Text as="label" size="1" color="gray" mt="2" style={{ display: "block" }}>
                    <Flex gap="1" align="center">
                      <Checkbox
                        size="1"
                        checked={includeReceipts}
                        onCheckedChange={(value) => setIncludeReceipts(value === true)}
                      />
                      Attach {receiptCount === 1 ? "the receipt" : `${receiptCount} receipts`} for
                      rebilled expenses
                    </Flex>
                  </Text>
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
                  <Text as="div" size="1" color="gray" mt="1">
                    This email only. Reminders re-attach the full PDF, and a client
                    link shows {receiptCount === 1 ? "the receipt" : "receipts"} either
                    way.
                  </Text>
                </>
              ) : null}
            </>
          ) : !canEmail ? (
            <Text as="div" size="1" color="gray" mt="2">
              Emailing isn&rsquo;t set up on this account yet, so you&rsquo;ll need to
              download the PDF and send it yourself.
            </Text>
          ) : (
            <Text as="div" size="1" color="gray" mt="2">
              {clientName} has no email address on file. Add one on their page to
              send from here.
            </Text>
          )}

          {!hasLines ? (
            // Visible, not a title= on a disabled button: a disabled
            // button is not focusable, so a tooltip is unreachable by
            // keyboard and silent to assistive tech.
            <Text as="div" size="1" color="gray" mt="2">
              Add at least one line before sending.
            </Text>
          ) : null}

          <Box mt="3">
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button disabled={pending || !hasLines} style={{ width: "100%" }}>
                  {pending
                    ? "Sending…"
                    : deliveryMethod === "platform_email"
                      ? "Send to client"
                      : "Mark as sent"}
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>
                  {deliveryMethod === "platform_email"
                    ? `Email this invoice to ${clientName}?`
                    : "Mark this invoice as sent?"}
                </AlertDialog.Title>
                <AlertDialog.Description size="2">
                  {deliveryMethod === "platform_email"
                    ? `It goes to ${clientEmail} with the PDF attached, and becomes read-only except for status, notes, and delivery. This can't be undone. Use "Preview PDF" above to see exactly what they'll get first.`
                    : "It becomes read-only except for status, notes, and delivery, and gets its permanent invoice number. This can't be undone. Use \"Preview PDF\" above to see exactly what the client will get before you send it."}
                </AlertDialog.Description>

                {/* OFFERED ONLY ON THE EMAIL PATH. "I'll send it myself"
                    sends no mail at all, so a message box there would take
                    a pilot's words and drop them — the silent-failure shape
                    this whole action was rewritten to stop. */}
                {deliveryMethod === "platform_email" ? (
                  <Box mt="3">
                    <Text as="label" size="1" weight="medium" htmlFor="send-note">
                      Add a message (optional)
                    </Text>
                    {/* NO maxLength — see NoteTooLong below. */}
                    <TextArea
                      id="send-note"
                      rows={3}
                      value={sendNote}
                      onChange={(event) => setSendNote(event.target.value)}
                      placeholder={`Anything ${clientName} should know about this one`}
                    />
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
                    <Text as="div" size="1" color="gray" mt="1">
                      Goes in this email only.{" "}
                      {!hasInvoiceTemplate
                        ? "The standard opening line, the amount due and the PDF are sent as usual."
                        : hasDueDate
                          ? "Your saved opening line, the amount due and the PDF are sent as usual."
                          : "Your saved opening line is used unless it mentions a due date. This invoice hasn’t got one, and the standard wording is sent instead. The amount due and the PDF go as usual."}
                    </Text>
                  </Box>
                ) : null}

                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Cancel
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button
                      variant="solid"
                      onClick={() => {
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
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </Box>
        </Box>
      ) : null}

      {/* CHASING AN INVOICE THAT IS ALREADY OUT. Deliberately manual: the
          pilot decides when to nudge their own client. This product will not
          send mail on a schedule to someone else's customer on their behalf —
          a badly-timed automatic chase costs a contract pilot the next
          booking, and they would have no idea it went out. */}
      {canRemind ? (
        <Box mb="4">
          {emailReady ? (
            <>
              <AlertDialog.Root>
                <AlertDialog.Trigger>
                  <Button
                    variant="outline"
                    style={{ width: "100%" }}
                    disabled={pending}
                  >
                    {pending ? "Sending…" : "Send a reminder"}
                  </Button>
                </AlertDialog.Trigger>
                <AlertDialog.Content maxWidth="420px">
                  <AlertDialog.Title>Send a reminder to {clientName}?</AlertDialog.Title>
                  {/* "The invoice attached again" is the WHOLE document,
                      receipt pages included — a reminder offers no receipts
                      toggle and does not remember whether the original send
                      had one ticked. Said here rather than left for a pilot
                      to discover after the fact, since the one case that
                      matters is the pilot who deliberately unticked it three
                      weeks ago. */}
                  <AlertDialog.Description size="2">
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
                  </AlertDialog.Description>

                  <Box mt="3">
                    <Text as="label" size="1" weight="medium" htmlFor="reminder-note">
                      Add a message (optional)
                    </Text>
                    {/* NO maxLength — see NoteTooLong below. */}
                    <TextArea
                      id="reminder-note"
                      rows={3}
                      value={reminderNote}
                      onChange={(event) => setReminderNote(event.target.value)}
                      placeholder="Anything to add to this reminder"
                    />
                    <NoteTooLong value={reminderNote} />
                    <Text as="div" size="1" color="gray" mt="1">
                      Goes in this reminder only.
                    </Text>
                  </Box>

                  <Flex gap="3" mt="4" justify="end">
                    <AlertDialog.Cancel>
                      <Button variant="soft" color="gray">
                        Cancel
                      </Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action>
                      <Button
                        variant="solid"
                        onClick={() => {
                          startTransition(async () => {
                            setError(null);
                            setSentNote(null);
                            const result = await sendInvoiceReminder(
                              invoice.id,
                              reminderNote
                            );
                            setError(result?.error ?? null);
                            if (!result?.error) {
                              setSentNote(`Reminder sent to ${clientEmail}.`);
                              setReminderNote("");
                            }
                          });
                        }}
                      >
                        Send reminder
                      </Button>
                    </AlertDialog.Action>
                  </Flex>
                </AlertDialog.Content>
              </AlertDialog.Root>
              <Text as="div" size="1" color="gray" mt="2">
                {automaticChase === "live"
                  ? "Reminders for this client also go out on their own, see the Reminders panel below for what is scheduled, and to pause it for this invoice."
                  : automaticChase === "paused"
                    ? `Automatic reminders are paused for this invoice, so chasing it is up to you. ${clientName}’s other open invoices are still chased on their schedule, see the Reminders panel below.`
                    : "You choose when to chase. Nothing goes out automatically for this client."}
              </Text>
            </>
          ) : (
            <Text as="div" size="1" color="gray">
              {canEmail
                ? `${clientName} has no email address on file, so reminders can’t be sent from here.`
                : "Emailing isn’t set up on this account yet, so reminders can’t be sent from here."}
            </Text>
          )}
        </Box>
      ) : null}

      {canVoid ? (
        <AlertDialog.Root>
          <AlertDialog.Trigger>
            <Button variant="outline" color="red" style={{ width: "100%" }} disabled={pending}>
              {pending ? "Working…" : "Void invoice"}
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Void this invoice?</AlertDialog.Title>
            <AlertDialog.Description size="2">This can&rsquo;t be undone.</AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button
                  variant="solid"
                  color="red"
                  onClick={() => {
                    startTransition(async () => {
                      setError(null);
                      setSentNote(null);
                      const result = await voidInvoice(invoice.id);
                      setError(result?.error ?? null);
                    });
                  }}
                >
                  Void invoice
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      ) : null}

      {error ? (
        <Box mt="3" role="alert">
          <Text size="1" color="red">
            {error}
          </Text>
        </Box>
      ) : null}

      {sentNote ? (
        <Box mt="3" role="status">
          <Text size="1" color="green">
            {sentNote}
          </Text>
        </Box>
      ) : null}
    </Card>
  );
}
