"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { Box, Button, Callout, Card, Flex, Text, TextField } from "@radix-ui/themes";
import { BRAND } from "@/lib/brand";
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

  return (
    <Card size="4" style={{ width: "100%", maxWidth: "22rem" }}>
      <form action={formAction}>
        <Flex direction="column" gap="3">
          <Flex direction="column" align="center" gap="1" mb="1">
            <Text size="6" weight="bold">
              {BRAND.name}
            </Text>
            <Text size="2" color="gray">
              Reset your password
            </Text>
          </Flex>

          {state.sent ? (
            <Text size="2" color="gray">
              If that email has an account, a reset link is on its way. The
              link is single-use and expires shortly, so use it soon.
            </Text>
          ) : (
            <>
              {expired ? (
                <Callout.Root color="red" size="1">
                  <Callout.Text>
                    That reset link has expired or was already used. Request
                    a new one below.
                  </Callout.Text>
                </Callout.Root>
              ) : null}

              <Text size="2" color="gray">
                Enter your email and we&rsquo;ll send you a link to set a new
                password.
              </Text>

              <Box>
                <Text as="label" size="2" weight="medium" htmlFor="email">
                  Email
                </Text>
                <TextField.Root
                  id="email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  mt="1"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Box>

              {state.error ? (
                <Text size="1" color="red" role="alert" aria-live="polite">
                  {state.error}
                </Text>
              ) : null}

              <Button type="submit" disabled={pending} mt="1">
                {pending ? "Sending…" : "Send reset link"}
              </Button>
            </>
          )}

          <Text asChild size="1" align="center">
            <NextLink href="/login">Back to sign in</NextLink>
          </Text>
        </Flex>
      </form>
    </Card>
  );
}
