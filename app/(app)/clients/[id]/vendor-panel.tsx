"use client";

import { useActionState, useEffect, useState } from "react";
import {
  AlertDialog,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Select,
  Text,
  TextField,
} from "@/components/ui";
import { formatDate } from "@/lib/format";
import { createVendorLink, revokeVendorLink, type VendorLinkState } from "../vendor-actions";

/**
 * "The vendor page" — one persistent link that answers the two questions a
 * 135 operator's AP desk otherwise re-emails a pilot for: what's still
 * open, and (if a credential packet is out for this client) where's your
 * paperwork. Mirrors packet-panel.tsx's create/rotate/revoke shape (same
 * days-valid picker, same candidateToken/revokedToken reconciliation so a
 * revoke never fights a later create across a render) and share-panel.tsx's
 * viewed-indicator wording (a fact about the LINK, not a claim about a
 * person — mail scanners fetch pages too).
 */

export type ExistingVendorLink = {
  /** Null while revoked, expired, or never created. */
  token: string | null;
  expiresAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
};

const DAY_CHOICES = ["30", "60", "90", "180", "365"];

const initial: VendorLinkState = { error: null };

export default function VendorPanel({
  clientId,
  clientName,
  existing,
  existingLoadError = false,
}: {
  clientId: string;
  clientName: string;
  existing: ExistingVendorLink | null;
  /**
   * A failed client_vendor_links read degrades `existing` to `null` the
   * same way "no live link" would — hiding the live-link block from a
   * pilot whose vendor page IS out with this client, and risking a second
   * one being minted on top of it. Same U4 shape as PacketPanel's own
   * documentsLoadError/existingLoadError.
   */
  existingLoadError?: boolean;
}) {
  const [state, formAction, creating] = useActionState(createVendorLink, initial);
  const [revokeState, revokeAction, revoking] = useActionState(revokeVendorLink, initial);
  const [days, setDays] = useState("90");
  const [copied, setCopied] = useState(false);

  const pending = creating || revoking;

  // Same reconciliation as PacketPanel's `token` — see its own comment for
  // the full reasoning behind this exact shape: a fresh create wins over
  // the server's existing row, and a revoke only clears the specific token
  // it targeted, not whatever this render happens to be showing.
  const candidateToken = state.token ?? existing?.token ?? null;
  const token =
    candidateToken &&
    revokeState.revoked &&
    (revokeState.revokedToken ?? candidateToken) === candidateToken
      ? null
      : candidateToken;

  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const url = token && origin ? `${origin}/vendor/${token}` : null;

  // Viewed stamps belong to the ROW's token. A freshly minted token this
  // render (state.token) has no stamps yet — a rotation clears them
  // server-side — so they must only be shown when the token on screen is
  // the same one the last server read described.
  const viewedRowMatches = Boolean(
    token && existing && existing.token === token && !state.token
  );
  const lastViewed = viewedRowMatches ? existing!.lastViewedAt : null;
  const firstViewed = viewedRowMatches ? existing!.firstViewedAt : null;

  useEffect(() => {
    setCopied(false);
  }, [token]);

  return (
    <Card size="3">
      <Heading size="4" mb="1">
        Vendor page for {clientName}
      </Heading>
      <Text as="p" size="2" color="gray" mb="3">
        One link for their accounts-payable desk: open invoices, total
        outstanding, payment history, and their paperwork if you&rsquo;ve
        shared any. It expires on its own, and you can revoke it any time.
      </Text>

      {existingLoadError && !token ? (
        <Callout.Root color="red" size="1" mb="3">
          <Callout.Text>
            Couldn&rsquo;t check whether a live vendor page already exists for{" "}
            {clientName} — this is not a statement that none is out. Reload
            before creating a new one.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {url ? (
        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">
            {state.token ? "Here's the link — send it to their AP desk" : "The live link"}
          </Text>
          <Flex gap="2" wrap="wrap" align="center">
            <TextField.Root value={url} readOnly aria-label="Vendor page link" style={undefined} />
            <Button
              type="button"
              variant="soft"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(
                  () => setCopied(true),
                  () => setCopied(false)
                );
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </Flex>
          {existing?.expiresAt ? (
            <Text size="1" color="gray">
              {`Stops working ${existing.expiresAt}. Replacing the link makes the old one dead immediately.`}
            </Text>
          ) : null}
          {/* Same honest ceiling as share-panel.tsx: fetched while valid,
              not "your client read it". */}
          <Text as="div" size="1" color="gray">
            {lastViewed
              ? `Viewed ${formatDate(lastViewed)}${
                  firstViewed && formatDate(firstViewed) !== formatDate(lastViewed)
                    ? ` · first opened ${formatDate(firstViewed)}`
                    : ""
                }. Opening counts even if it was an email scanner, not their AP desk.`
              : "Not viewed yet."}
          </Text>

          <Flex gap="3" align="end" wrap="wrap" mt="2">
            <form action={formAction}>
              <input type="hidden" name="client_id" value={clientId} />
              <input type="hidden" name="days_valid" value={days} />
              <Flex gap="3" align="end" wrap="wrap">
                <Flex direction="column" gap="1">
                  <Text as="label" size="2" weight="medium" id="vendor-days-label">
                    New link works for
                  </Text>
                  <Select.Root value={days} onValueChange={setDays}>
                    <Select.Trigger aria-labelledby="vendor-days-label" />
                    <Select.Content>
                      {DAY_CHOICES.map((d) => (
                        <Select.Item key={d} value={d}>
                          {`${d} days`}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Flex>
                <Button type="submit" variant="outline" disabled={pending}>
                  {creating ? "Replacing…" : "Replace the link"}
                </Button>
              </Flex>
            </form>

            {/* CONFIRMED, same reasoning as PacketPanel's Revoke: this
                breaks a link a pilot may have already emailed to a client's
                AP desk, with no warning on their end that it's about to
                404. */}
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button type="button" variant="ghost" size="2" color="red" disabled={pending}>
                  {revoking ? "Revoking…" : "Revoke this link"}
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>Revoke this vendor page?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  The link stops working immediately. If their AP desk has it
                  bookmarked or in their email, it will 404 for them — create
                  a new one if they still need it.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Cancel
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <form action={revokeAction}>
                      <input type="hidden" name="client_id" value={clientId} />
                      <input type="hidden" name="revoking_token" value={token ?? ""} />
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
          {revokeState.revoked ? (
            <Text size="1" color="gray">
              The previous link was revoked.
            </Text>
          ) : null}
          <form action={formAction}>
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="days_valid" value={days} />
            <Flex gap="3" align="end" wrap="wrap">
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="medium" id="vendor-days-label-new">
                  Link works for
                </Text>
                <Select.Root value={days} onValueChange={setDays}>
                  <Select.Trigger aria-labelledby="vendor-days-label-new" />
                  <Select.Content>
                    {DAY_CHOICES.map((d) => (
                      <Select.Item key={d} value={d}>
                        {`${d} days`}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Flex>
              <Button type="submit" disabled={pending}>
                {creating ? "Creating…" : "Create the link"}
              </Button>
            </Flex>
          </form>
        </Flex>
      )}

      {state.error ? (
        <Callout.Root color="red" mt="3" size="1">
          <Callout.Text>{state.error}</Callout.Text>
        </Callout.Root>
      ) : null}
      {revokeState.error && (revokeState.revokedToken ?? token) === token ? (
        <Callout.Root color="red" mt="3" size="1">
          <Callout.Text>{revokeState.error}</Callout.Text>
        </Callout.Root>
      ) : null}
    </Card>
  );
}
