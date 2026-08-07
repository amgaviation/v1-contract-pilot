"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { Box, Button, Card, Flex, Text, TextField } from "@radix-ui/themes";
import { BRAND } from "@/lib/brand";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  // React 19 resets an uncontrolled form on every action dispatch,
  // including the error path — a wrong password would otherwise blank
  // the email field too. Keep email controlled so it survives a failed
  // submit; the password is intentionally never echoed back.
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
              {BRAND.descriptor}
            </Text>
          </Flex>

          <input type="hidden" name="next" value={next} />

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
              autoComplete="current-password"
              required
              mt="1"
            />
          </Box>

          {state.error ? (
            <Text size="1" color="red" role="alert" aria-live="polite">
              {state.error}
            </Text>
          ) : null}

          <Button type="submit" disabled={pending} mt="1">
            {pending ? "Signing in…" : "Sign in"}
          </Button>

          <Flex direction="column" align="center" gap="1" mt="1">
            <Text asChild size="1">
              <NextLink href="/forgot-password">Forgot your password?</NextLink>
            </Text>
            <Text size="1" color="gray">
              New here?{" "}
              <Text asChild size="1">
                <NextLink href="/signup">Create an account</NextLink>
              </Text>
            </Text>
          </Flex>
        </Flex>
      </form>
    </Card>
  );
}
