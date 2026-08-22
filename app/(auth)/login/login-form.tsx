"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { LAlert } from "@/components/ledger";
import { LInput } from "@/components/ledger/forms";
import { AuthCard, AuthFooter, AuthHeading, Field, FormError, SubmitButton } from "../auth-parts";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

/**
 * `deleted` is the confirmation for a just-deleted account. It is the only
 * place the pilot is told the delete worked, so it says both halves of what
 * actually happened: the tenant and its records are gone (pilot.delete_account
 * cascaded), and the auth.users row is NOT. 20260818090000_account_lifecycle.sql
 * leaves Supabase's own table alone on purpose, so the same email and password
 * still sign in. Saying only the first half is what made "I deleted my account
 * and I can still log in" read as a failed delete.
 *
 * WHAT THE SECOND HALF MAY NOT SAY, and this is a claim rule rather than a
 * wording preference. Signing in again does NOT produce an account. The
 * membership row cascaded with the tenant, so getSessionContext() returns a
 * session with no account, requireAccount() sends it to /welcome, and
 * /welcome is the plan picker: three tiers, live Stripe prices, and a card
 * at checkout. Only the Stripe webhook creates a tenant (decision #7, see
 * app/(auth)/welcome/actions.ts). An earlier draft of this alert said
 * signing in "starts a brand new account with nothing in it", which promises
 * a free re-creation the product does not perform. That is a price claim
 * made by omission on app/(auth)/, and docs/MARKETING.md's scope block
 * (above §1, "app/(auth)/ is inside the scope, not adjacent to it") binds
 * this surface to §5's claim rules exactly as hard as the landing page. The
 * copy below names the plan step instead, and states no amount.
 *
 * That scope block is also worth reading before editing this comment. Its
 * two recorded failures are both on /signup, not here, and the second one
 * is this exact situation: a guarding comment forbade a claim, and the
 * REPLACEMENT LINE WRITTEN UNDER IT made the same claim in a quieter voice.
 * So the block above is not a check. Re-read the strings against §5 by hand.
 */
export default function LoginForm({
  next,
  deleted = false,
}: {
  next: string;
  deleted?: boolean;
}) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  // React 19 resets an uncontrolled form on every action dispatch,
  // including the error path — a wrong password would otherwise blank
  // the email field too. Keep email controlled so it survives a failed
  // submit; the password is intentionally never echoed back.
  const [email, setEmail] = useState("");

  return (
    <AuthCard>
      <AuthHeading title="Sign in">
        {deleted ? null : "Pick up where your last trip left off."}
      </AuthHeading>

      {deleted ? (
        <LAlert tone="good" className="flex flex-col gap-2">
          <p>
            Your account is deleted. Every record in it is gone and support
            can&rsquo;t bring it back.
          </p>
          <p>
            Your sign-in email still works. It won&rsquo;t bring the account
            back, and starting over means picking a plan again.
          </p>
        </LAlert>
      ) : null}

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
