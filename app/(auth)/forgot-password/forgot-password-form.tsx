"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { EnvelopeClosedIcon } from "@radix-ui/react-icons";
import { Callout, Flex, Heading, Link, Text, TextField } from "@/components/ui";
import {
  AuthFooter,
  AuthHeading,
  Field,
  FormError,
  SubmitButton,
} from "../auth-parts";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = { error: null, sent: false };

export default function ForgotPasswordForm({
  expired = false,
}: {
  expired?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialState
  );

  // React 19 resets an uncontrolled form on every action dispatch,
  // including the error path — a rejected submit would otherwise blank
  // the email field too. Keep it controlled so it survives.
  const [email, setEmail] = useState("");

  // The sent state is a screen of its own rather than a paragraph swapped
  // into the form: the form has nothing left to do, and leaving it on
  // screen invites a second submit that would send a second link.
  if (state.sent) {
    return (
      <Flex direction="column" gap="6">
        <Flex direction="column" gap="3" align="start">
          <Text color="indigo" aria-hidden>
            <EnvelopeClosedIcon width="32" height="32" />
          </Text>
          <Heading as="h1" size="7" trim="start">
            Check your email
          </Heading>
          <Text as="p" size="2" color="gray">
            If that email has an account, a reset link is on its way. The link
            is single-use and expires shortly, so use it soon.
          </Text>
        </Flex>

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
      <AuthHeading title="Reset your password">
        Enter your email and we&rsquo;ll send you a link to set a new one.
      </AuthHeading>

      {expired ? (
        <Callout.Root color="amber" size="1">
          <Callout.Text>
            That reset link has expired or was already used. Request a new one
            below.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      <form action={formAction}>
        <Flex direction="column" gap="4">
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

          <FormError message={state.error} />

          <SubmitButton
            pending={pending}
            idle="Send reset link"
            busy="Sending…"
          />
        </Flex>
      </form>

      <AuthFooter>
        <Link asChild size="2">
          <NextLink href="/login">Back to sign in</NextLink>
        </Link>
      </AuthFooter>
    </Flex>
  );
}
