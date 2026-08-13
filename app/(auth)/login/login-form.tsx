"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { Flex, Link, Text, TextField } from "@/components/ui";
import {
  AuthFooter,
  AuthHeading,
  Field,
  FormError,
  SubmitButton,
} from "../auth-parts";
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
    <Flex direction="column" gap="6">
      <AuthHeading title="Sign in">
        Pick up where your last trip left off.
      </AuthHeading>

      <form action={formAction}>
        <Flex direction="column" gap="4">
          <input type="hidden" name="next" value={next} />

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

          <Field id="password" label="Password">
            <TextField.Root
              id="password"
              type="password"
              name="password"
              size="3"
              autoComplete="current-password"
              required
              disabled={pending}
            />
          </Field>

          <FormError message={state.error} />

          <SubmitButton pending={pending} idle="Sign in" busy="Signing in…" />
        </Flex>
      </form>

      {/* Link, NOT Text asChild. `<Text asChild>` renders the anchor with
          class "rt-Text" and nothing else — .rt-Text sets only line-height
          and letter-spacing, and colour comes exclusively from
          .rt-Text:where([data-accent-color]), which is only stamped when a
          `color` prop is passed. With none, the anchor fell through to the
          UA sheet: #0000EE and an underline. Link adds rt-reset (all:unset
          on the anchor) plus rt-Link, which is what every in-app link
          already uses. */}
      <AuthFooter>
        <Link asChild size="2">
          <NextLink href="/forgot-password">Forgot your password?</NextLink>
        </Link>
        <Text size="2" color="gray">
          New here?{" "}
          <Link asChild size="2">
            <NextLink href="/signup">Create an account</NextLink>
          </Link>
        </Text>
      </AuthFooter>
    </Flex>
  );
}
