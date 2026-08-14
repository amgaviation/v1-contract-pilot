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
 * PAYMENT-LINK MODEL: connecting Stripe here lets an invoice's detail
 * screen generate a Stripe-hosted Payment Link for a specific client to
 * pay — by card, by bank payment (ACH), or both, per the panel beside this
 * one. The payment is then recorded on the invoice automatically when the
 * money actually settles (app/api/stripe/connect-webhook/route.ts).
 *
 * THE PARAGRAPH THAT USED TO BE HERE SAID THE OPPOSITE, and it was true
 * when it was written: "there is no automatic 'we detect the payment and
 * mark the invoice paid' step — the pilot records it the same way as a
 * cheque or wire." That gap was closed by
 * supabase/migrations/20260813100000_connect_auto_payments.sql, and a
 * comment describing a manual step the software now performs is worse than
 * no comment — it tells the next reader the pilot must do something they
 * must not do twice. See payment-panel.tsx's header for the full picture.
 */
export default function ConnectPanel({
  configured,
  canEdit,
  connected,
  warning,
  justConnected,
}: {
  /** STRIPE_CONNECT_CLIENT_ID is set on this deployment — resolved server-side. */
  configured: boolean;
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
                    "Disconnect Stripe? You won't be able to generate new payment links, and \"Pay online\" will disappear from your invoices. A link you already sent keeps working on your own Stripe account until you deactivate it yourself from your Stripe Dashboard. That includes a bank payment (ACH) already authorised and still settling. It will land in your Stripe balance without being recorded here."
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
        ) : !configured ? (
          /* STRIPE_CONNECT_CLIENT_ID is unset on this deployment, so the
             OAuth hop cannot be built. Said plainly here rather than left
             to startConnectOnboarding, where connectClientId() throws:
             inside a server action that throw becomes an unhandled 500 and
             the pilot reads a blank error page after clicking a button the
             product offered them. Same posture the reminders panel takes
             when CRON_SECRET is missing — a control that cannot work is
             not shown as though it can. */
          <Text size="2" color="gray">
            Online payments aren&rsquo;t switched on for this deployment yet, so
            there&rsquo;s nothing to connect to. Invoices still send and can be
            paid the way they are today.
          </Text>
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
