"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { LInput } from "@/components/ledger/forms";
import { AuthCard, AuthFooter, AuthHeading, Field, FormError, SubmitButton } from "../auth-parts";
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
    <AuthCard>
      <AuthHeading title="Sign in">Pick up where your last trip left off.</AuthHeading>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <Field id="email" label="Email">
          <LInput
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            autoFocus
            required
            disabled={pending}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field id="password" label="Password">
          <LInput
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            disabled={pending}
          />
        </Field>

        <FormError message={state.error} />

        <SubmitButton pending={pending} idle="Sign in" busy="Signing in…" />
      </form>

      <AuthFooter>
        <NextLink
          href="/forgot-password"
          className="text-body-s font-medium text-accent hover:underline"
        >
          Forgot your password?
        </NextLink>
        <p className="text-body-s text-ink-2">
          New here?{" "}
          <NextLink href="/signup" className="font-medium text-accent hover:underline">
            Create an account
          </NextLink>
        </p>
      </AuthFooter>
    </AuthCard>
  );
}
