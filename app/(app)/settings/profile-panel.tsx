"use client";

import { useActionState } from "react";
import { LAlert, LButton, LCard, LPill, LRow, LRows, LSeparator } from "@/components/ledger";
import { LField, LInput } from "@/components/ledger/forms";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import {
  changeEmail,
  changePassword,
  revokeOtherSessions,
  type ProfileFormState,
} from "./profile-actions";

const initialState: ProfileFormState = { error: null, notice: null };

/**
 * PROFILE & SECURITY — the signed-in PERSON, kept deliberately separate
 * from the business record on the "Your business" tab.
 *
 * That separation is the whole point of the tab existing. `legal_name`,
 * the invoice address and the certificate number describe a BUSINESS and
 * print on documents a client reads. The email and password here are how
 * ONE HUMAN gets in, they are shared with nobody, and on a multi-seat
 * account they differ per member while the business record does not. A
 * single "Settings" blob would have made a bookkeeper's password look like
 * an account-wide field.
 *
 * WHAT THIS COMPONENT IS TRUSTED WITH. Scalars only — never the Supabase
 * `User` object. Handing a client component a whole `user` puts every
 * field of it (app_metadata, identities, provider tokens) into the RSC
 * flight payload regardless of what the prop's TYPE claims, which is the
 * same reasoning settings/page.tsx records for the `accounts` row.
 *
 * THREE INDEPENDENT FORMS, three independent useActionState hooks. They
 * are not one form with three buttons: each has its own pending state, its
 * own error line and its own success sentence, and a failed password
 * change must not blank a half-typed email address in the form above it.
 */
export default function ProfilePanel({
  email,
  emailConfirmed,
  pendingEmail,
  pendingEmailSentAt,
  lastSignInAt,
  memberSince,
  roleLabel,
  accountName,
}: {
  email: string | null;
  emailConfirmed: boolean;
  /** Supabase `user.new_email` — set while a change awaits confirmation. */
  pendingEmail: string | null;
  pendingEmailSentAt: string | null;
  lastSignInAt: string | null;
  memberSince: string | null;
  roleLabel: string;
  accountName: string;
}) {
  const [emailState, emailAction, emailPending] = useActionState(
    changeEmail,
    initialState
  );
  const [passwordState, passwordAction, passwordPending] = useActionState(
    changePassword,
    initialState
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeOtherSessions,
    initialState
  );

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-h3 font-semibold">Profile &amp; security</h3>

      {/* ------------------------------------------------------------ identity */}
      <LCard>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lead font-bold">{email ?? "No email on file"}</span>
            {emailConfirmed ? (
              <LPill tone="good">Confirmed</LPill>
            ) : (
              <LPill tone="warn">Not confirmed</LPill>
            )}
            <LPill tone="neutral">{roleLabel}</LPill>
          </div>

          <LRows>
            <LRow>
              <span className="text-caption text-ink-3">Account</span>
              <span className="text-body-s">{accountName}</span>
            </LRow>
            <LRow>
              <span className="text-caption text-ink-3">Last signed in</span>
              <span className="text-body-s">{lastSignInAt ?? "—"}</span>
            </LRow>
            <LRow>
              <span className="text-caption text-ink-3">Signed up</span>
              <span className="text-body-s">{memberSince ?? "—"}</span>
            </LRow>
          </LRows>

          {/* The pending-change indicator is read from the SESSION USER on
              every render (user.new_email), not from the one-shot notice
              the action returns — so it survives a reload and a new tab,
              which is exactly when a pilot goes looking for it. */}
          {pendingEmail ? (
            <LAlert tone="warn">
              {`An email change to ${pendingEmail} is waiting for confirmation${
                pendingEmailSentAt ? ` (requested ${pendingEmailSentAt})` : ""
              }. It is NOT in effect yet. Keep signing in with ${
                email ?? "your current address"
              } until you've opened the link we sent. Starting a new change below replaces this one.`}
            </LAlert>
          ) : null}
        </div>
      </LCard>

      {/* -------------------------------------------------------- change email */}
      <LCard>
        <form action={emailAction}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-lead font-bold">Change your sign-in email</span>
              <p className="text-body-s text-ink-2">
                We send a confirmation link to the new address. The change takes effect
                when you open it, not when you press this button. Until then your old
                address is still the one that signs you in.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <LField label="New email address" htmlFor="profile-email">
                  <LInput
                    id="profile-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    defaultValue={emailState.values?.email ?? ""}
                  />
                </LField>
              </div>
              <div className="flex-1">
                <LField label="Your current password" htmlFor="profile-email-password">
                  <LInput
                    id="profile-email-password"
                    name="current_password"
                    type="password"
                    autoComplete="current-password"
                  />
                </LField>
              </div>
            </div>

            <Outcome state={emailState} />

            <div>
              <LButton type="submit" disabled={emailPending}>
                {emailPending ? "Sending confirmation…" : "Send confirmation link"}
              </LButton>
            </div>
          </div>
        </form>
      </LCard>

      {/* ----------------------------------------------------- change password */}
      <LCard>
        <form action={passwordAction}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-lead font-bold">Change your password</span>
              <p className="text-body-s text-ink-2">
                {`Your current password is required; a signed-in browser alone isn't enough to set a new one. At least ${MIN_PASSWORD_LENGTH} characters.`}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <LField label="Current password" htmlFor="profile-current-password">
                  <LInput
                    id="profile-current-password"
                    name="current_password"
                    type="password"
                    autoComplete="current-password"
                  />
                </LField>
              </div>
              <div className="flex-1">
                <LField label="New password" htmlFor="profile-new-password">
                  <LInput
                    id="profile-new-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                  />
                </LField>
              </div>
              <div className="flex-1">
                <LField label="Repeat new password" htmlFor="profile-confirm-password">
                  <LInput
                    id="profile-confirm-password"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                  />
                </LField>
              </div>
            </div>

            <Outcome state={passwordState} />

            <div>
              <LButton type="submit" disabled={passwordPending}>
                {passwordPending ? "Changing…" : "Change password"}
              </LButton>
            </div>
          </div>
        </form>
      </LCard>

      <LSeparator />

      {/* -------------------------------------------------- other sessions */}
      <LCard>
        <form action={revokeAction}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-lead font-bold">Sign out everywhere else</span>
              <p className="text-body-s text-ink-2">
                Ends your session on every other device and browser: a phone left at an
                FBO, a shared dispatch machine, a laptop you no longer have. This browser
                stays signed in.
              </p>
              <p className="text-caption text-ink-3">
                Revoked sessions can&rsquo;t be listed per device, so no names or
                locations are shown here rather than invented.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <LField label="Your current password" htmlFor="profile-revoke-password">
                  <LInput
                    id="profile-revoke-password"
                    name="current_password"
                    type="password"
                    autoComplete="current-password"
                  />
                </LField>
              </div>
              <div>
                <LButton type="submit" variant="danger" disabled={revokePending}>
                  {revokePending ? "Signing out…" : "Sign out other devices"}
                </LButton>
              </div>
            </div>

            <Outcome state={revokeState} />
          </div>
        </form>
      </LCard>
    </div>
  );
}

/**
 * The outcome line for one form. Every dispatch lands on exactly one of
 * these two branches — there is no third, silent one, which is the rule
 * this whole tab was built to satisfy. `role="alert"` + `aria-live` so a
 * screen reader hears the result without moving focus.
 */
function Outcome({ state }: { state: ProfileFormState }) {
  return (
    <div role="alert" aria-live="polite">
      {state.error ? (
        <p className="text-body-s font-medium text-crit">{state.error}</p>
      ) : state.notice ? (
        <p className="text-body-s font-medium text-good">{state.notice}</p>
      ) : null}
    </div>
  );
}
