"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertDialog, Button, Card, Flex, Text, TextField } from "@/components/ui";
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
    <Card size="3">
      <Text as="div" size="4" weight="bold" mb="2">
        Share with client
      </Text>
      <Text as="div" size="1" color="gray" mb="3">
        A link your client can open without an account — the quote, its status,
        and buttons to accept or decline it, if it&rsquo;s still awaiting an
        answer. You send it; nothing here emails it for you.
      </Text>

      {shareUrl ? (
        <Flex direction="column" gap="2" width="100%">
          <TextField.Root readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          <Text as="div" size="1" color="gray">
            {viewed
              ? `Viewed ${formatDate(viewed)}${
                  firstViewed && formatDate(firstViewed) !== formatDate(viewed)
                    ? ` · first opened ${formatDate(firstViewed)}`
                    : ""
                }. Opening counts even if it was an email scanner, not your client.`
              : "Not viewed yet."}
          </Text>
          <Flex gap="2">
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  style={{ flex: 1, width: "100%" }}
                >
                  {creating ? "Rotating…" : "Generate a new link"}
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>Replace this client link?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  The link you already sent stops working immediately — if your client
                  has it bookmarked or in their inbox, it will 404 for them. You&rsquo;ll
                  get a new link to send instead.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Keep the current link
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <form action={createAction}>
                      <input type="hidden" name="estimate_id" value={estimateId} />
                      <Button type="submit" variant="solid" disabled={pending}>
                        Replace it
                      </Button>
                    </form>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button type="button" variant="outline" color="red" disabled={pending}>
                  Revoke
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>Revoke this client link?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  The link stops working immediately. If your client has it bookmarked or in
                  their email, it will 404 for them — generate a new one if they still need
                  access.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Cancel
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <form action={revokeAction}>
                      <input type="hidden" name="estimate_id" value={estimateId} />
                      <Button type="submit" variant="solid" color="red" disabled={pending}>
                        Revoke
                      </Button>
                    </form>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </Flex>
        </Flex>
      ) : (
        <Flex direction="column" gap="2" align="start">
          {share?.revoked_at ? (
            <Text size="1" color="gray">
              The previous link was revoked.
            </Text>
          ) : null}
          <form action={createAction}>
            <input type="hidden" name="estimate_id" value={estimateId} />
            <Button type="submit" disabled={pending}>
              {creating ? "Creating…" : "Create client link"}
            </Button>
          </form>
        </Flex>
      )}

      {error ? (
        <Text as="div" size="1" color="red" mt="2" role="alert">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}
