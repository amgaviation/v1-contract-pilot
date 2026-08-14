"use client";

import { useState, useTransition } from "react";
import { AlertDialog, Box, Button, Card, Flex, Text, TextArea } from "@/components/ui";
import { MAX_CUSTOM_MESSAGE_CHARS } from "@/lib/email/invoice-message";
import { sendEstimate } from "../actions";

/**
 * "Email this estimate" — the client-facing send, distinct from "Mark as
 * sent" (status-actions.tsx), which only records that the pilot quoted the
 * client some other way. This is the surface that actually puts the PDF in
 * an inbox, mirroring invoices' StatusActions "Send a reminder" dialog:
 * same AlertDialog confirmation, same controlled per-send note (Radix's
 * reset-event trap — see status-actions.tsx's own comment on why the
 * TextArea is controlled), same "Goes to {email}" honesty so a pilot never
 * confirms a send without knowing which inbox it reaches.
 *
 * Only rendered for a non-draft estimate ([id]/page.tsx) — a draft has no
 * permanent number yet and sendEstimate itself refuses one regardless of
 * what this component shows.
 */
function NoteTooLong({ value }: { value: string }) {
  const over = value.trim().length - MAX_CUSTOM_MESSAGE_CHARS;
  if (over <= 0) return null;
  return (
    <Text as="div" size="1" color="red" mt="1">
      {over.toLocaleString()} character{over === 1 ? "" : "s"} over the{" "}
      {MAX_CUSTOM_MESSAGE_CHARS.toLocaleString()}-character limit. Shorten it.
      Nothing will be sent until you do.
    </Text>
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

  const emailReady = canEmail && Boolean(clientEmail);

  return (
    <Card size="3">
      <Text as="div" size="4" weight="bold" mb="2">
        Email this quote
      </Text>

      {emailReady ? (
        <>
          <Text as="div" size="1" color="gray" mb="3">
            Goes to {clientEmail} with the PDF attached. You can send it again any
            time. This doesn&rsquo;t change the estimate or its status.
          </Text>
          <AlertDialog.Root>
            <AlertDialog.Trigger>
              <Button style={{ width: "100%" }} disabled={pending}>
                {pending ? "Sending…" : `Email it to ${clientName}`}
              </Button>
            </AlertDialog.Trigger>
            <AlertDialog.Content maxWidth="420px">
              <AlertDialog.Title>Email this quote to {clientName}?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                It goes to {clientEmail} with the PDF attached, marked as an
                estimate. No payment is requested. Use &ldquo;Preview PDF&rdquo;
                above to see exactly what they&rsquo;ll get first.
              </AlertDialog.Description>

              <Box mt="3">
                <Text as="label" size="1" weight="medium" htmlFor="estimate-send-note">
                  Add a message (optional)
                </Text>
                {/* NO maxLength — see NoteTooLong above, same reasoning as
                    status-actions.tsx: a silently truncated paste is worse
                    than a visible over-length warning. */}
                <TextArea
                  id="estimate-send-note"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={`Anything ${clientName} should know about this quote`}
                />
                <NoteTooLong value={note} />
                <Text as="div" size="1" color="gray" mt="1">
                  Goes in this email only. The estimate total and the PDF are
                  sent as usual.
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
                    disabled={note.trim().length > MAX_CUSTOM_MESSAGE_CHARS}
                    onClick={() => {
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
                  >
                    Send it
                  </Button>
                </AlertDialog.Action>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </>
      ) : !canEmail ? (
        <Text as="div" size="1" color="gray">
          Emailing isn&rsquo;t set up on this account yet, so you&rsquo;ll need to
          download the PDF and send it yourself.
        </Text>
      ) : (
        <Text as="div" size="1" color="gray">
          {clientName} has no email address on file. Add one on their page to
          send from here.
        </Text>
      )}

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
