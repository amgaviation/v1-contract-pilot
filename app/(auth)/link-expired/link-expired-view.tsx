"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import {
  Button,
  Callout,
  Flex,
  Heading,
  Link,
  Text,
  TextField,
} from "@/components/ui";
import { RESEND_SENT_MESSAGE } from "@/lib/auth/confirmation";
import { AuthFooter, Field, FormError, SubmitButton } from "../auth-parts";
import { resendConfirmation, type ResendState } from "../resend-actions";

const initialState: ResendState = { error: null, sent: false };

export default function LinkExpiredView({
  flow,
  knownEmail,
}: {
  flow: "signup" | "email-change";
  knownEmail: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    resendConfirmation,
    initialState
  );

  // React 19 resets an uncontrolled form on every action dispatch, the
  // rejected ones included, so a refused resend would otherwise blank the
  // address the pilot just typed.
  const [email, setEmail] = useState("");

  /**
   * AN EMAIL CHANGE CANNOT BE RESENT FROM A SIGNED-OUT SCREEN.
   * `resend({ type: "email_change" })` acts on the signed-in user's pending
   * address, and re-authentication is what authorises the change in the
   * first place (settings/profile-actions.ts). So this half sends them back
   * to the screen that can do it properly rather than offering a control
   * that would fail.
   */
  if (flow === "email-change") {
    return (
      <Flex direction="column" gap="6">
        <Flex direction="column" gap="3" align="start">
          <Text color="amber" aria-hidden>
            <ExclamationTriangleIcon width="32" height="32" />
          </Text>
          <Heading as="h1" size="7" trim="start">
            That link has expired
          </Heading>
          <Text as="p" size="2" color="gray">
            Your sign-in address has not changed. Sign in with the address you
            used before and start the change again from Settings.
          </Text>
        </Flex>

        <Button asChild size="3" style={{ width: "100%" }}>
          <NextLink href="/settings?tab=profile">Go to Profile &amp; security</NextLink>
        </Button>

        <AuthFooter>
          <Link asChild size="2">
            <NextLink href="/login">Back to sign in</NextLink>
          </Link>
        </AuthFooter>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="3" align="start">
        <Text color="amber" aria-hidden>
          <ExclamationTriangleIcon width="32" height="32" />
        </Text>
        <Heading as="h1" size="7" trim="start">
          That link has expired
        </Heading>
        <Text as="p" size="2" color="gray">
          Confirmation links are single-use and expire. Send yourself a fresh
          one, then open the newest email.
        </Text>
      </Flex>

      <form action={formAction}>
        <Flex direction="column" gap="4">
          {/* No field when the pending-signup cookie already names the
              address: the action reads it from there, and a field would be
              an address the caller chooses. */}
          {knownEmail ? (
            <Text as="p" size="2" color="gray">
              Sending to{" "}
              <Text size="2" weight="medium">
                {knownEmail}
              </Text>
              .
            </Text>
          ) : (
            <Field id="email" label="Email">
              <TextField.Root
                id="email"
                type="email"
                name="email"
                size="3"
                autoComplete="email"
                autoFocus
                required
                disabled={pending}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          )}

          {state.sent ? (
            <Callout.Root color="green" size="1">
              <Callout.Text>{RESEND_SENT_MESSAGE}</Callout.Text>
            </Callout.Root>
          ) : null}

          <FormError message={state.error} />

          <SubmitButton
            pending={pending}
            idle="Send a new link"
            busy="Sending…"
          />
        </Flex>
      </form>

      <AuthFooter>
        <Text size="2" color="gray">
          No account yet?{" "}
          <Link asChild size="2">
            <NextLink href="/signup">Create one</NextLink>
          </Link>
        </Text>
        <Link asChild size="2">
          <NextLink href="/login">Back to sign in</NextLink>
        </Link>
      </AuthFooter>
    </Flex>
  );
}
