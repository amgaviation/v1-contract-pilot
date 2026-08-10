"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertDialog, Button, Card, Flex, Text, TextField } from "@/components/ui";
import { createInvoiceShare, revokeInvoiceShare, type ShareState } from "../share-actions";

/**
 * "Share with client" — the client-facing counterpart to PaymentPanel's
 * "Pay online". A pilot generates a link here and sends it themselves
 * (same manual-last-step shape as the Stripe payment link two features up
 * this branch: this app never emails anything — see StatusActions'
 * platform_email comment); the client opens it, unauthenticated, at
 * app/invoice/[token]/page.tsx and sees the invoice plus a Pay button if
 * one exists.
 *
 * Only rendered for a 'sent'/'partial'/'paid' invoice — draft/void never
 * reach this component (see [id]/page.tsx) — matching
 * pilot.invoice_share_create's own status gate, so the button is never
 * offered where the database would refuse it.
 */

const initialState: ShareState = { error: null };

export type ShareRow = { token: string; revoked_at: string | null } | null;

export default function SharePanel({
  invoiceId,
  share,
}: {
  invoiceId: string;
  share: ShareRow;
}) {
  const [createState, createAction, creating] = useActionState(createInvoiceShare, initialState);
  const [revokeState, revokeAction, revoking] = useActionState(revokeInvoiceShare, initialState);

  // The token this render should show: a freshly-minted one from THIS
  // request beats whatever was already on the row, so the pilot sees the
  // new link immediately after rotating without waiting on revalidation.
  const liveToken = createState.token ?? (share && !share.revoked_at ? share.token : null);

  // Built client-side (window.location.origin) rather than from an env
  // var: this component only ever renders inside the authenticated app,
  // which is always reached at the same origin the public /invoice/[token]
  // route is served from, and avoids a second "keep this in sync with the
  // deployment URL" configuration knob.
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const shareUrl = liveToken && origin ? `${origin}/invoice/${liveToken}` : null;

  const pending = creating || revoking;
  const error = createState.error ?? revokeState.error;

  return (
    <Card size="3">
      <Text as="div" size="4" weight="bold" mb="2">
        Share with client
      </Text>
      <Text as="div" size="1" color="gray" mb="3">
        A link your client can open without an account — the invoice, its status, and a Pay
        button if one is set up. You send it; nothing here emails it for you.
      </Text>

      {shareUrl ? (
        <Flex direction="column" gap="2" width="100%">
          <TextField.Root readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          <Flex gap="2">
            {/* CONFIRMED, like Revoke beside it. Rotating is not a gentler
                action than revoking — it revokes AND replaces in one press.
                Whatever link the client already has stops working the
                instant this is clicked, and the pilot has no way to know
                the client had it open. An unconfirmed button that breaks
                something on someone else's screen is the wrong shape. */}
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
                      <input type="hidden" name="invoice_id" value={invoiceId} />
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
                      <input type="hidden" name="invoice_id" value={invoiceId} />
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
            <input type="hidden" name="invoice_id" value={invoiceId} />
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
