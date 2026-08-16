"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { LAlert, LCard } from "@/components/ledger";
import { LInput } from "@/components/ledger/forms";
import { AuthFooter, AuthHeading, Field, FormError, SubmitButton } from "../auth-parts";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = { error: null, sent: false };

function MailIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

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
      <LCard className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col items-start gap-3">
          <MailIcon className="text-accent" />
          <h1 className="text-h1 font-bold text-ink">Check your email</h1>
          <p className="text-body-s text-ink-2">
            If that email has an account, a reset link is on its way. The link
            is single-use and expires shortly, so use it soon.
          </p>
        </div>

        <AuthFooter>
          <NextLink href="/login" className="text-body-s font-medium text-accent hover:underline">
            Back to sign in
          </NextLink>
        </AuthFooter>
      </LCard>
    );
  }

  return (
    <LCard className="flex flex-col gap-6 p-6 sm:p-8">
      <AuthHeading title="Reset your password">
        Enter your email and we&rsquo;ll send you a link to set a new one.
      </AuthHeading>

      {expired ? (
        <LAlert tone="warn">
          That reset link has expired or was already used. Request a new one
          below.
        </LAlert>
      ) : null}

      <form action={formAction} className="flex flex-col gap-4">
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

        <FormError message={state.error} />

        <SubmitButton pending={pending} idle="Send reset link" busy="Sending…" />
      </form>

      <AuthFooter>
        <NextLink href="/login" className="text-body-s font-medium text-accent hover:underline">
          Back to sign in
        </NextLink>
      </AuthFooter>
    </LCard>
  );
}
