"use client";

import { useActionState } from "react";
import NextLink from "next/link";
import { EnvelopeClosedIcon } from "@radix-ui/react-icons";
import { Callout, Flex, Heading, Link, Text } from "@/components/ui";
import { RESEND_SENT_MESSAGE } from "@/lib/auth/confirmation";
import { AuthFooter, FormError, SubmitButton } from "../auth-parts";
import { resendConfirmation, type ResendState } from "../resend-actions";

const initialState: ResendState = { error: null, sent: false };

/**
 * The resend form carries NO email field: the action reads the address from
 * the httpOnly pending-signup cookie that got the pilot to this screen. A
 * field here would be an address the caller chooses, which is the account
 * enumeration shape resend-actions.ts's header rules out.
 */
export default function CheckEmailView({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(
    resendConfirmation,
    initialState
  );

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
          Open the confirmation link we sent to{" "}
          <Text size="2" weight="medium">
            {email}
          </Text>
          , then pick your plan. The link is single-use and expires, so use it
          soon.
        </Text>
      </Flex>

      <form action={formAction}>
        <Flex direction="column" gap="3">
          {state.sent ? (
            <Callout.Root color="green" size="1">
              <Callout.Text>{RESEND_SENT_MESSAGE}</Callout.Text>
            </Callout.Root>
          ) : null}

          <FormError message={state.error} />

          <SubmitButton
            pending={pending}
            idle="Send it again"
            busy="Sending…"
            variant="soft"
          />
        </Flex>
      </form>

      <AuthFooter>
        <Text size="2" color="gray">
          Wrong address?{" "}
          <Link asChild size="2">
            <NextLink href="/signup">Sign up again</NextLink>
          </Link>
        </Text>
        <Link asChild size="2">
          <NextLink href="/login">Back to sign in</NextLink>
        </Link>
      </AuthFooter>
    </Flex>
  );
}
