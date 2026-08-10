"use client";

import { useActionState } from "react";
import { Button, Callout, Card, Flex, Heading, Text } from "@/components/ui";
import { startConnectOnboarding, disconnectStripeConnect, type DisconnectState } from "./connect-actions";

const initialState: DisconnectState = { error: null };

/**
 * Stripe Connect (Standard) onboarding/disconnect — settings' "business"
 * tab. Client component only for the two tiny bits of interactivity
 * (submit state, a confirm before disconnect); the account's connection
 * state itself is server-rendered data, passed in as props.
 *
 * PAYMENT-LINK-ONLY MODEL: connecting Stripe here lets an invoice's
 * detail screen generate a Stripe-hosted Payment Link for a specific
 * client to pay. There is no automatic "we detect the payment and mark
 * the invoice paid" step — the pilot sees the payment land in their own
 * Stripe Dashboard (this platform is never in the funds path to see it
 * either) and records it the same way as a cheque or wire, from the
 * Payments panel on the invoice. See payment-panel.tsx's header comment
 * for the full reasoning.
 */
export default function ConnectPanel({
  canEdit,
  connected,
  warning,
  justConnected,
}: {
  canEdit: boolean;
  connected: boolean;
  warning?: string;
  justConnected?: boolean;
}) {
  const [state, formAction, pending] = useActionState(disconnectStripeConnect, initialState);

  return (
    <Card>
      <Flex direction="column" gap="3" p="1">
        <Flex direction="column" gap="1">
          <Heading size="4">Get paid online</Heading>
          <Text size="2" color="gray">
            Connect your own Stripe account so clients can pay an invoice by card
            online. You&rsquo;re the merchant of record — payments settle straight
            to your own Stripe balance. This platform never sees your Stripe
            keys, never holds your funds, and never takes a cut.
          </Text>
        </Flex>

        {warning ? (
          <Callout.Root color="amber" size="1">
            <Callout.Text>{warning}</Callout.Text>
          </Callout.Root>
        ) : null}
        {justConnected ? (
          <Callout.Root color="green" size="1">
            <Callout.Text>Stripe connected. You can generate a payment link from any sent invoice.</Callout.Text>
          </Callout.Root>
        ) : null}

        {connected ? (
          <Flex direction="column" gap="2" align="start">
            <Text size="2" weight="medium" color="green">
              Stripe connected
            </Text>
            {canEdit ? (
              <form
                action={formAction}
                onSubmit={(e) => {
                  const ok = window.confirm(
                    "Disconnect Stripe? You won't be able to generate new payment links, and \"Pay online\" will disappear from your invoices. A link already sent to a client keeps working on your own Stripe account until you deactivate it yourself from your Stripe Dashboard."
                  );
                  if (!ok) e.preventDefault();
                }}
              >
                <Button type="submit" variant="outline" color="red" disabled={pending}>
                  {pending ? "Disconnecting…" : "Disconnect Stripe"}
                </Button>
              </form>
            ) : null}
            <Flex direction="column" gap="2" role="alert" aria-live="polite">
              {state.error ? (
                <Text size="1" color="red">
                  {state.error}
                </Text>
              ) : null}
              {/* The disconnect landed here, but Stripe wouldn't confirm the
                  grant was removed on their side. Amber, not red: what the
                  pilot asked for did happen locally; what's left is a task
                  only they can finish, in their own dashboard. */}
              {state.warning ? (
                <Callout.Root color="amber" size="1">
                  <Callout.Text>{state.warning}</Callout.Text>
                </Callout.Root>
              ) : null}
            </Flex>
          </Flex>
        ) : canEdit ? (
          <form action={startConnectOnboarding}>
            <Button type="submit" style={{ width: "100%" }}>
              Connect with Stripe
            </Button>
          </form>
        ) : (
          <Text size="2" color="gray">
            Ask an account owner to connect Stripe.
          </Text>
        )}
      </Flex>
    </Card>
  );
}
