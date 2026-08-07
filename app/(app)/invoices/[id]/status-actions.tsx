"use client";

import { useState, useTransition } from "react";
import { AlertDialog, Box, Button, Card, Flex, Select, Text } from "@/components/ui";
import { sendInvoice, voidInvoice } from "../actions";

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
 */
export default function StatusActions({
  invoice,
  hasLines,
}: {
  invoice: InvoiceForActions;
  hasLines: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<"platform_email" | "manual_download">(
    "manual_download"
  );

  if (invoice.status === "paid" || invoice.status === "void") {
    return null;
  }

  const canSend = invoice.status === "draft";
  const canVoid = invoice.status === "draft" || invoice.status === "sent" || invoice.status === "partial";

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
                {/* `platform_email` is a valid value in the schema and is
                    deliberately NOT offered here: nothing in this codebase
                    sends mail. Offering it would let a pilot mark a $14,000
                    invoice "Emailed from here", watch it lock read-only and
                    start ageing toward invoices_overdue, while the client
                    received nothing. The schema permitting a value is not
                    permission for the UI to offer it before a sender
                    exists — put this option back the day one does. */}
                <Select.Item value="manual_download">I&rsquo;ll send it myself</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>
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
                  {pending ? "Sending…" : "Mark as sent"}
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>Mark this invoice as sent?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  It becomes read-only except for status, notes, and delivery, and gets its
                  permanent invoice number. This can&rsquo;t be undone — use &ldquo;Preview
                  PDF&rdquo; above to see exactly what the client will get before you send it.
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
                          const result = await sendInvoice(invoice.id, deliveryMethod);
                          setError(result?.error ?? null);
                        });
                      }}
                    >
                      Mark as sent
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </Box>
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
    </Card>
  );
}
