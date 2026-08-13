"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertDialog, Button, Card, Flex, Text, TextField } from "@/components/ui";
import { formatDate } from "@/lib/format";
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
 *
 * THIS PANEL IS WHERE A PILOT CONSENTS TO WHAT THE LINK DISCLOSES, which
 * is why the copy below has to name all of it. Creating a link is a
 * deliberate per-invoice act — no invoice has a public URL until this
 * button is pressed — and that is what makes "my client can see this" an
 * informed choice rather than a default. It stops being informed the
 * moment the page shows something this panel never mentioned. So the
 * receipts sentence below is load-bearing, not decoration: since
 * 20260813020000 the link renders the receipt IMAGE for every rebilled
 * line that has one, and StatusActions' "Attach N receipts" checkbox
 * governs the EMAILED PDF only — it is a per-send choice, stored nowhere,
 * and it has no bearing on this surface. A pilot who does not want a
 * particular receipt image in their client's hands revokes this link or
 * never creates it. That is the control, and it only works if this panel
 * says what the link shows.
 */

const initialState: ShareState = { error: null };

export type ShareRow = {
  token: string;
  revoked_at: string | null;
  /**
   * Stamped by pilot.invoice_share_mark_viewed (20260812200000) when the
   * link is FETCHED while valid. "Viewed" is a fact about the link, not
   * about a person — mail scanners and link previewers fetch pages too —
   * and the copy below is worded to claim exactly that much and no more.
   * The pilot's own signed-in preview never stamps (excluded in the
   * function body), so their own checking doesn't fake a client view.
   */
  first_viewed_at: string | null;
  last_viewed_at: string | null;
} | null;

export default function SharePanel({
  invoiceId,
  share,
  receiptCount,
}: {
  invoiceId: string;
  share: ShareRow;
  /**
   * Rebill lines on THIS invoice whose expense has a receipt on file —
   * the same server-resolved count StatusActions and the download button
   * take ([id]/page.tsx), and exactly the set pilot.invoice_share_receipts
   * will return for this invoice's token. 0 means the link has no receipt
   * to show, so the sentence below does not claim one.
   *
   * It is a COUNT rather than a boolean because the copy names it: "the
   * two receipts" is checkable against the lines on screen, whereas "any
   * receipts" would leave a pilot to work out which lines qualify.
   */
  receiptCount: number;
}) {
  const [createState, createAction, creating] = useActionState(createInvoiceShare, initialState);
  const [revokeState, revokeAction, revoking] = useActionState(revokeInvoiceShare, initialState);

  // The token this render should show: a freshly-minted one from THIS
  // request beats whatever was already on the row, so the pilot sees the
  // new link immediately after rotating without waiting on revalidation.
  const liveToken = createState.token ?? (share && !share.revoked_at ? share.token : null);

  // Viewed state belongs to the token on the ROW. A rotation clears the
  // stamps server-side (invoice_share_create nulls them with revoked_at),
  // so when this render is showing a freshly-minted token that isn't the
  // row's token yet, the row's stamps describe the OLD link and must not
  // be shown against the new one.
  const viewed =
    liveToken && share && !share.revoked_at && share.token === liveToken
      ? share.last_viewed_at
      : null;
  const firstViewed =
    liveToken && share && !share.revoked_at && share.token === liveToken
      ? share.first_viewed_at
      : null;

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

      {/* SAID BEFORE THE LINK EXISTS, not after. This sits above the
          create/rotate controls so a pilot reads it while deciding, and it
          is deliberately NOT phrased as a reassurance: the emailed PDF's
          receipts checkbox is a per-send choice that is stored nowhere, so
          a pilot who unticked it for this invoice would otherwise have no
          way to learn that the link they are about to hand over shows the
          images anyway. See this component's header. */}
      {receiptCount > 0 ? (
        <Text as="div" size="1" color="gray" mb="3">
          It also shows{" "}
          {receiptCount === 1
            ? "the receipt for the rebilled expense"
            : `the ${receiptCount} receipts for rebilled expenses`}{" "}
          on this invoice, whether or not you attached{" "}
          {receiptCount === 1 ? "it" : "them"} to the email. Revoke the link if you&rsquo;d
          rather your client didn&rsquo;t see {receiptCount === 1 ? "it" : "them"}.
        </Text>
      ) : null}

      {shareUrl ? (
        <Flex direction="column" gap="2" width="100%">
          <TextField.Root readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          {/* States exactly what is knowable: the LINK was opened while
              valid. Mail scanners and link previewers open links, so this
              deliberately never says "your client read it" — Wave's viewed
              tracking has the same property and the same honest ceiling. */}
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
