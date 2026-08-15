"use client";

import { useState, useTransition } from "react";
import { AlertDialog, Box, Button, Card, Flex, Text } from "@/components/ui";
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
      <Card size="3">
        <Text as="div" size="4" weight="bold" mb="2">
          Status
        </Text>
        <Text as="div" size="2" color="gray">
          Accepted and converted to an invoice. This estimate is frozen. Its
          figures are the basis of that document.
        </Text>
      </Card>
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
    <Card size="3">
      <Text as="div" size="4" weight="bold" mb="2">
        Status
      </Text>

      {expiredDays !== null ? (
        <Text as="div" size="1" color="amber" mb="3">
          The valid-until date passed {expiredDays === 1 ? "1 day" : `${expiredDays} days`} ago.
          The quoted price no longer stands on its own. Revise and re-send it,
          or record the client&rsquo;s answer if they gave one in time.
        </Text>
      ) : null}

      {canSend ? (
        <Box mb="4">
          {estimate.status === "draft" ? (
            <>
              {!hasLines ? (
                // Visible, not a title= on a disabled button — a disabled
                // button is not focusable, so a tooltip there is silent to
                // keyboards and assistive tech.
                <Text as="div" size="1" color="gray" mb="2">
                  Add at least one line before sending. A quote with nothing on
                  it totals $0.00.
                </Text>
              ) : null}
              <AlertDialog.Root>
                <AlertDialog.Trigger>
                  <Button disabled={pending || !hasLines} style={{ width: "100%" }}>
                    {pending ? "Working…" : "Mark as sent"}
                  </Button>
                </AlertDialog.Trigger>
                <AlertDialog.Content maxWidth="420px">
                  <AlertDialog.Title>Mark this estimate as sent?</AlertDialog.Title>
                  <AlertDialog.Description size="2">
                    {estimate.estimate_number
                      ? `It keeps its number ${estimate.estimate_number} and moves back to Sent, waiting on ${clientName}'s answer.`
                      : `It gets its permanent estimate number and today's date. Nothing is emailed from here. You send the quote to ${clientName} yourself. You can still revise and re-send it afterwards.`}
                  </AlertDialog.Description>
                  <Flex gap="3" mt="4" justify="end">
                    <AlertDialog.Cancel>
                      <Button variant="soft" color="gray">
                        Cancel
                      </Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action>
                      <Button variant="solid" onClick={() => run(markEstimateSent)}>
                        Mark as sent
                      </Button>
                    </AlertDialog.Action>
                  </Flex>
                </AlertDialog.Content>
              </AlertDialog.Root>
            </>
          ) : (
            // declined -> sent: the client said no, the conversation
            // reopened. Number and record survive.
            <Button
              variant="outline"
              style={{ width: "100%" }}
              disabled={pending}
              onClick={() => run(markEstimateSent, "Back out as a live quote.")}
            >
              {pending ? "Working…" : "Send it again"}
            </Button>
          )}
        </Box>
      ) : null}

      {canAccept || canDecline ? (
        <Box mb="4">
          <Text as="div" size="1" color="gray" mb="2">
            Record {clientName}&rsquo;s answer:
          </Text>
          <Flex gap="2" direction="column">
            {canAccept ? (
              <Button
                disabled={pending}
                onClick={() => run(markEstimateAccepted, "Marked accepted.")}
              >
                {pending ? "Working…" : "Mark accepted"}
              </Button>
            ) : null}
            {canDecline ? (
              <Button
                variant="outline"
                color="red"
                disabled={pending}
                onClick={() => run(markEstimateDeclined, "Marked declined.")}
              >
                {pending ? "Working…" : "Mark declined"}
              </Button>
            ) : null}
          </Flex>
        </Box>
      ) : null}

      {canRevise ? (
        <Box mb="4">
          <Button
            variant="outline"
            style={{ width: "100%" }}
            disabled={pending}
            onClick={() => run(reviseEstimate, "Back in draft. Edit and re-send.")}
          >
            {pending ? "Working…" : "Revise"}
          </Button>
          <Text as="div" size="1" color="gray" mt="2">
            Takes it back to draft to change lines or terms, then re-send. It
            keeps its number.
          </Text>
        </Box>
      ) : null}

      {canConvert ? (
        <Box mb="4">
          {!hasLines ? (
            <Text as="div" size="1" color="gray" mb="2">
              This estimate has no lines, so there&rsquo;s nothing to put on an
              invoice.
            </Text>
          ) : null}
          <AlertDialog.Root>
            <AlertDialog.Trigger>
              <Button disabled={pending || !hasLines} style={{ width: "100%" }}>
                {pending ? "Converting…" : "Convert to invoice"}
              </Button>
            </AlertDialog.Trigger>
            <AlertDialog.Content maxWidth="420px">
              <AlertDialog.Title>Convert this estimate to an invoice?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                Creates a draft invoice carrying every line and the tax rate as
                quoted. You still review and send that invoice; nothing goes to{" "}
                {clientName} now. Afterwards this estimate is frozen and can&rsquo;t
                convert a second time.
              </AlertDialog.Description>
              <Flex gap="3" mt="4" justify="end">
                <AlertDialog.Cancel>
                  <Button variant="soft" color="gray">
                    Cancel
                  </Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action>
                  <Button variant="solid" onClick={() => run(convertEstimateToInvoice)}>
                    Convert
                  </Button>
                </AlertDialog.Action>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </Box>
      ) : null}

      {canDelete ? (
        <AlertDialog.Root>
          <AlertDialog.Trigger>
            <Button variant="outline" color="red" style={{ width: "100%" }} disabled={pending}>
              {pending ? "Working…" : "Delete draft"}
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Delete this draft estimate?</AlertDialog.Title>
            <AlertDialog.Description size="2">
              It was never sent, so nothing references it. This can&rsquo;t be
              undone.
            </AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button variant="solid" color="red" onClick={() => run(deleteEstimateDraft)}>
                  Delete draft
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      ) : null}

      {estimate.status === "draft" && estimate.estimate_number !== null ? (
        <Text as="div" size="1" color="gray" mt="3">
          This estimate has been sent before, so it keeps its number and its
          record. It can&rsquo;t be deleted, only revised and re-sent.
        </Text>
      ) : null}

      {error ? (
        <Box mt="3" role="alert">
          <Text size="1" color="red">
            {error}
          </Text>
        </Box>
      ) : null}

      {note ? (
        <Box mt="3" role="status">
          <Text size="1" color="green">
            {note}
          </Text>
        </Box>
      ) : null}
    </Card>
  );
}
