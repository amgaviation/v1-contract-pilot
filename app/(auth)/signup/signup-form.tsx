"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { Box, Button, Card, Flex, Text, TextField } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = { error: null };

export default function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  // React 19 resets an uncontrolled form on every action dispatch,
  // including the error path — a rejected submit would otherwise blank
  // the email field too. Keep email controlled so it survives; the
  // password is intentionally never echoed back.
  const [email, setEmail] = useState("");

  if (state.needsConfirmation) {
    return (
      <Card size="4" style={{ width: "100%", maxWidth: "22rem" }}>
        <Flex direction="column" align="center" gap="3" style={{ textAlign: "center" }}>
          <Text size="5" weight="bold">
            Check your email
          </Text>
          <Text size="2" color="gray">
            Click the confirmation link we just sent, then sign in to start
            your trial.
          </Text>
          <Button asChild mt="2">
            <NextLink href="/login">Go to sign in</NextLink>
          </Button>
        </Flex>
      </Card>
    );
  }

  return (
    <Card size="4" style={{ width: "100%", maxWidth: "22rem" }}>
      <form action={formAction}>
        <Flex direction="column" gap="3">
          <Flex direction="column" align="center" gap="1" mb="1">
            <Text size="6" weight="bold">
              Start your trial
            </Text>
            <Text size="2" color="gray">
              {BRAND.name} — {BRAND.descriptor}
            </Text>
          </Flex>

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
          <Box>
            <Text as="label" size="2" weight="medium" htmlFor="password">
              Password
            </Text>
            <TextField.Root
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              mt="1"
            />
            <Text as="div" size="1" color="gray" mt="1">
              At least 8 characters
            </Text>
          </Box>

          {state.error ? (
            <Text size="1" color="red" role="alert" aria-live="polite">
              {state.error}
            </Text>
          ) : null}

          <Button type="submit" disabled={pending} mt="1">
            {pending ? "Creating account…" : "Create account"}
          </Button>

          {/*
            "See our", NOT "by creating an account you agree to our". Both
            linked pages say in their own bodies that no document has been
            published yet and that nothing on them is binding. Printing an
            agreement sentence over them would assert a legal fact at the exact
            moment a pilot hands over a card — one this product has no basis
            for and records nowhere. The links are honest; the sentence was
            not. It comes back when counsel's text lands and acceptance is
            actually captured (docs/LAUNCH-GATES.md G3).
          */}
          <Text size="1" color="gray" align="center">
            See our{" "}
            <Text asChild size="1">
              <NextLink href="/terms">Terms</NextLink>
            </Text>{" "}
            and{" "}
            <Text asChild size="1">
              <NextLink href="/privacy">Privacy Policy</NextLink>
            </Text>
            .
          </Text>

          <Text size="1" color="gray" align="center">
            Already have an account?{" "}
            <Text asChild size="1">
              <NextLink href="/login">Sign in</NextLink>
            </Text>
          </Text>
        </Flex>
      </form>
    </Card>
  );
}
