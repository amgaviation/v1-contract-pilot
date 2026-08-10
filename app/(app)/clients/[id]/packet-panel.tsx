"use client";

import { useActionState, useEffect, useState } from "react";
import {
  AlertDialog,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Heading,
  Select,
  Text,
  TextField,
} from "@/components/ui";
import { createPacketShare, revokePacketShare, type PacketState } from "../packet-actions";

/**
 * "Send this client your paperwork" — the packet a pilot otherwise
 * re-attaches to an email for every new client, and again every time
 * something expires.
 *
 * The pilot ticks what goes in. That is the whole point of the design:
 * the link means "these documents", not "my wallet". A client who asked
 * for a W-9 must not receive a passport because it was on the same
 * screen.
 */

export type PacketDocument = {
  id: string;
  kind: string;
  label: string;
  expiresOn: string | null;
};

export type ExistingPacket = {
  /** Null while revoked or never created. */
  token: string | null;
  expiresAt: string | null;
  documentCount: number;
};

const DAY_CHOICES = ["7", "14", "30", "60", "90"];

const initial: PacketState = { error: null };

export default function PacketPanel({
  clientId,
  clientName,
  documents,
  existing,
}: {
  clientId: string;
  clientName: string;
  documents: PacketDocument[];
  existing: ExistingPacket | null;
}) {
  const [state, formAction, creating] = useActionState(createPacketShare, initial);
  const [revokeState, revokeAction, revoking] = useActionState(revokePacketShare, initial);
  const [days, setDays] = useState("30");
  const [copied, setCopied] = useState(false);

  const pending = creating || revoking;

  // The freshest token this render should show: a freshly minted one from
  // THIS create beats whatever the server already had, so the pilot sees
  // the new link immediately without waiting on revalidatePath's
  // re-render (same reasoning as SharePanel's `liveToken`).
  const candidateToken = state.token ?? existing?.token ?? null;

  // A revoke nulls OUT the specific token it targeted, not "whatever
  // token this panel is showing right now". revokeState.revokedToken is
  // echoed back by revokePacketShare from the hidden `revoking_token`
  // input, i.e. it names the exact token that revoke dispatch tried to
  // kill. Scoping the check to that identity — rather than a bare
  // `revokeState.revoked` latch — is what lets it self-clear: once a
  // LATER create mints a different token, candidateToken no longer
  // equals revokedToken and this branch is simply moot, so the new link
  // renders normally without anything having to reset revokeState. A
  // bare latch cannot do that — it stays true for the rest of the mount,
  // so create A, revoke A, create B would render NO link for B while the
  // panel simultaneously said "the previous link was revoked" under a
  // "Replace the link" button: three contradictory statements about the
  // same packet on one render.
  // `revokedToken ?? candidateToken` rather than a bare `revokedToken`
  // comparison: if a dispatch ever came back without a token to name (the
  // hidden `revoking_token` field missing or empty), this must not read as
  // "doesn't match, so show the link" — it fails toward hiding a possibly
  // revoked link, not toward showing one.
  const token =
    candidateToken &&
    revokeState.revoked &&
    (revokeState.revokedToken ?? candidateToken) === candidateToken
      ? null
      : candidateToken;
  const url = token
    ? `${typeof window === "undefined" ? "" : window.location.origin}/packet/${token}`
    : null;

  // Copied is per-link: it must not survive a token change and claim a
  // different link is on the clipboard than the one actually copied.
  useEffect(() => {
    setCopied(false);
  }, [token]);

  return (
    <Card size="3">
      <Heading size="4" mb="1">
        Paperwork for {clientName}
      </Heading>
      <Text as="p" size="2" color="gray" mb="3">
        One link with the documents this client asked for. It expires on its
        own, and you can revoke it at any time.
      </Text>

      {documents.length === 0 ? (
        <Text size="2" color="gray">
          Nothing to send yet — add a W-9, a certificate of insurance or your
          day-rate agreement under Documents first.
        </Text>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="days_valid" value={days} />

          <Flex direction="column" gap="2" mb="3">
            {documents.map((doc) => (
              <Text as="label" size="2" key={doc.id}>
                <Flex gap="2" align="center">
                  <Checkbox name={`doc:${doc.id}`} />
                  {doc.label}
                  <Text size="1" color="gray">
                    {doc.expiresOn ? `expires ${doc.expiresOn}` : doc.kind}
                  </Text>
                </Flex>
              </Text>
            ))}
          </Flex>

          <Flex gap="3" align="end" wrap="wrap">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" id="packet-days-label">
                Link works for
              </Text>
              <Select.Root value={days} onValueChange={setDays}>
                <Select.Trigger aria-labelledby="packet-days-label" />
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
              {creating ? "Creating…" : token ? "Replace the link" : "Create the link"}
            </Button>
          </Flex>

          {state.error ? (
            <Callout.Root color="red" mt="3" size="1">
              <Callout.Text>{state.error}</Callout.Text>
            </Callout.Root>
          ) : null}
        </form>
      )}

      {/* Gated on `!url`, which is itself already derived from the
          revokedToken match above — so this only shows once the token it
          is talking about has actually been cleared off screen, not for
          the whole remaining lifetime of the mount. */}
      {!url && revokeState.revoked ? (
        <Text as="p" size="1" color="gray" mt="2">
          The previous link was revoked.
        </Text>
      ) : null}

      {url ? (
        <Flex direction="column" gap="2" mt="4">
          <Text size="2" weight="medium">
            {state.token ? "Here's the link — send it to them" : "The live link"}
          </Text>
          <Flex gap="2" wrap="wrap" align="center">
            <TextField.Root value={url} readOnly aria-label="Packet link" style={undefined} />
            <Button
              type="button"
              variant="soft"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(
                  () => setCopied(true),
                  // A clipboard permission refusal is not an error worth a
                  // banner — the field beside it is selectable.
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
          {/* CONFIRMED, same reasoning as SharePanel's Revoke: clicking this
              breaks a link the pilot may already have emailed, and the
              client's browser tab gives no warning that it is about to
              404. An unconfirmed one-click revoke on a passport/insurance
              link is the wrong shape. */}
          <AlertDialog.Root>
            <AlertDialog.Trigger>
              <Button type="button" variant="ghost" size="1" color="red" disabled={pending}>
                {revoking ? "Revoking…" : "Revoke this link"}
              </Button>
            </AlertDialog.Trigger>
            <AlertDialog.Content maxWidth="420px">
              <AlertDialog.Title>Revoke this client link?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                The link stops working immediately. If your client has it bookmarked or in
                their email, it will 404 for them — create a new one if they still need these
                documents.
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
                    {/* Echoes back exactly the token this render is
                        showing, so revokePacketShare's returned
                        revokedToken can be compared against a later
                        render's own token — see the `token` derivation
                        above and packet-actions.ts's comment on it. */}
                    <input type="hidden" name="revoking_token" value={token ?? ""} />
                    <Button type="submit" variant="solid" color="red" disabled={pending}>
                      Revoke
                    </Button>
                  </form>
                </AlertDialog.Action>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
          {/* Scoped to the token this failed revoke was actually about, the
              same way the success path is scoped above — otherwise a
              revoke that failed on an old token would keep showing this
              error underneath a brand new link a subsequent create just
              made live, which is not a failure of anything on screen
              anymore. `revokedToken ?? token`, not a bare comparison: an
              error path that returns without echoing revoking_token (the
              client_id check in revokePacketShare, before revokingToken
              is even read) must not read as "doesn't match, so drop the
              error" — the same fail-closed reasoning as the `token`
              derivation above. */}
          {revokeState.error && (revokeState.revokedToken ?? token) === token ? (
            <Callout.Root color="red" size="1">
              <Callout.Text>{revokeState.error}</Callout.Text>
            </Callout.Root>
          ) : null}
        </Flex>
      ) : null}
    </Card>
  );
}
