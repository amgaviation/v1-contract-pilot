"use client";

import { useState, useTransition } from "react";
import { AlertDialog, Box, Button, Card, Checkbox, Flex, Select, Text } from "@/components/ui";
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
export default function StatusActions({
  invoice,
  hasLines,
  canEmail,
  clientEmail,
  clientName,
  receiptCount,
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
                    ? `It goes to ${clientEmail} with the PDF attached, and becomes read-only except for status, notes, and delivery. This can’t be undone — use “Preview PDF” above to see exactly what they’ll get first.`
                    : "It becomes read-only except for status, notes, and delivery, and gets its permanent invoice number. This can’t be undone — use “Preview PDF” above to see exactly what the client will get before you send it."}
                </AlertDialog.Description>
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
                            deliveryMethod === "platform_email" ? includeReceipts : true
                          );
                          setError(result?.error ?? null);
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
                  <AlertDialog.Description size="2">
                    A short follow-up goes to {clientEmail} with the invoice attached
                    again. It doesn&rsquo;t change the invoice or add any late fee.
                  </AlertDialog.Description>
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
                            const result = await sendInvoiceReminder(invoice.id);
                            setError(result?.error ?? null);
                            if (!result?.error) {
                              setSentNote(`Reminder sent to ${clientEmail}.`);
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
                You choose when to chase — nothing goes out automatically.
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
