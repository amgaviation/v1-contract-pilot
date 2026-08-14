"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog, Button, Flex, Text } from "@/components/ui";
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
 */
export default function RespondPanel({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function respond(action: (token: string) => Promise<{ error: string | null }>) {
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
    <Flex direction="column" gap="2" mt="4">
      <Flex gap="2">
        <AlertDialog.Root>
          <AlertDialog.Trigger>
            <Button size="3" style={{ flex: 1 }} disabled={pending}>
              {pending ? "Working…" : "Accept this quote"}
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Accept this quote?</AlertDialog.Title>
            <AlertDialog.Description size="2">
              Your pilot will see this as accepted and can turn it into an
              invoice for the work. This doesn&rsquo;t charge you anything now.
            </AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button variant="solid" onClick={() => respond(acceptPublicEstimate)}>
                  Accept
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
        <AlertDialog.Root>
          <AlertDialog.Trigger>
            <Button size="3" variant="outline" color="red" style={{ flex: 1 }} disabled={pending}>
              Decline
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Decline this quote?</AlertDialog.Title>
            <AlertDialog.Description size="2">
              Your pilot will see this as declined. If you change your mind, ask
              them to send it again.
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
                  color="red"
                  onClick={() => respond(declinePublicEstimate)}
                >
                  Decline
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      </Flex>
      {error ? (
        <Text as="div" size="1" color="red" role="alert">
          {error}
        </Text>
      ) : null}
    </Flex>
  );
}
