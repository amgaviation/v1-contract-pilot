"use client";

import { useActionState, useState } from "react";
import {
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
  const [state, formAction, pending] = useActionState(createPacketShare, initial);
  const [days, setDays] = useState("30");
  const [copied, setCopied] = useState(false);

  // The freshly minted token, else whatever is already live. The RPC
  // rotates on re-share, so at most one is ever current.
  const token = state.token ?? existing?.token ?? null;
  const url = token
    ? `${typeof window === "undefined" ? "" : window.location.origin}/packet/${token}`
    : null;

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
              {pending ? "Creating…" : existing?.token ? "Replace the link" : "Create the link"}
            </Button>
          </Flex>

          {state.error ? (
            <Callout.Root color="red" mt="3" size="1">
              <Callout.Text>{state.error}</Callout.Text>
            </Callout.Root>
          ) : null}
        </form>
      )}

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
          <form action={revokePacketShare}>
            <input type="hidden" name="client_id" value={clientId} />
            <Button type="submit" variant="ghost" size="1">
              Revoke this link
            </Button>
          </form>
        </Flex>
      ) : null}
    </Card>
  );
}
