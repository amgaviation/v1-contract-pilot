"use client";

import { useActionState } from "react";
import { LInput } from "@/components/ledger/forms";
import { AuthCard, AuthHeading, Field, FormError, SubmitButton } from "../auth-parts";
import { setNewPassword, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = { error: null };

export default function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    setNewPassword,
    initialState
  );

  return (
    <AuthCard>
      <AuthHeading title="Choose a new password">
        You&rsquo;re signed in from the emailed link. Set a password and
        you&rsquo;re back in.
      </AuthHeading>

      <form action={formAction} className="flex flex-col gap-4">
        <Field id="password" label="New password" hint="At least 8 characters">
          <LInput
            id="password"
            type="password"
            name="password"
            autoComplete="new-password"
            aria-describedby="password-hint"
            autoFocus
            required
            disabled={pending}
          />
        </Field>

        <Field id="confirm" label="Confirm new password">
          <LInput
            id="confirm"
            type="password"
            name="confirm"
            autoComplete="new-password"
            required
            disabled={pending}
          />
        </Field>

        <FormError message={state.error} />

        <SubmitButton pending={pending} idle="Save password" busy="Saving…" />
      </form>
    </AuthCard>
  );
}
