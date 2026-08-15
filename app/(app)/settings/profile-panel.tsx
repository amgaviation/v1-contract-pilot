"use client";

import { useActionState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  DataList,
  Flex,
  Heading,
  Separator,
  Text,
  TextField,
} from "@/components/ui";
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
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="1">
        <Heading as="h3" size="4">
          Profile &amp; security
        </Heading>
      </Flex>

      {/* ------------------------------------------------------------ identity */}
      <Card>
        <Flex direction="column" gap="3" p="1">
          <Flex align="center" gap="2" wrap="wrap">
            <Text weight="bold" size="3">
              {email ?? "No email on file"}
            </Text>
            {emailConfirmed ? (
              <Badge color="green">Confirmed</Badge>
            ) : (
              <Badge color="amber">Not confirmed</Badge>
            )}
            <Badge color="gray">{roleLabel}</Badge>
          </Flex>

          <DataList.Root size="2" orientation={{ initial: "vertical", sm: "horizontal" }}>
            <DataList.Item>
              <DataList.Label minWidth="140px">Account</DataList.Label>
              <DataList.Value>{accountName}</DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label minWidth="140px">Last signed in</DataList.Label>
              <DataList.Value>{lastSignInAt ?? "—"}</DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label minWidth="140px">Signed up</DataList.Label>
              <DataList.Value>{memberSince ?? "—"}</DataList.Value>
            </DataList.Item>
          </DataList.Root>

          {/* The pending-change indicator is read from the SESSION USER on
              every render (user.new_email), not from the one-shot notice
              the action returns — so it survives a reload and a new tab,
              which is exactly when a pilot goes looking for it. */}
          {pendingEmail ? (
            <Callout.Root color="amber">
              <Callout.Text>
                {`An email change to ${pendingEmail} is waiting for confirmation${
                  pendingEmailSentAt ? ` (requested ${pendingEmailSentAt})` : ""
                }. It is NOT in effect yet. Keep signing in with ${
                  email ?? "your current address"
                } until you've opened the link we sent. Starting a new change below replaces this one.`}
              </Callout.Text>
            </Callout.Root>
          ) : null}
        </Flex>
      </Card>

      {/* -------------------------------------------------------- change email */}
      <Card>
        <form action={emailAction}>
          <Flex direction="column" gap="3" p="1">
            <Flex direction="column" gap="1">
              <Text weight="bold" size="3">
                Change your sign-in email
              </Text>
              <Text size="2" color="gray">
                We send a confirmation link to the new address. The change takes effect
                when you open it, not when you press this button. Until then your old
                address is still the one that signs you in.
              </Text>
            </Flex>

            <Flex direction={{ initial: "column", sm: "row" }} gap="3">
              <Flex direction="column" gap="1" flexGrow="1">
                <Text as="label" size="2" htmlFor="profile-email">
                  New email address
                </Text>
                <TextField.Root
                  id="profile-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  defaultValue={emailState.values?.email ?? ""}
                />
              </Flex>
              <Flex direction="column" gap="1" flexGrow="1">
                <Text as="label" size="2" htmlFor="profile-email-password">
                  Your current password
                </Text>
                <TextField.Root
                  id="profile-email-password"
                  name="current_password"
                  type="password"
                  autoComplete="current-password"
                />
              </Flex>
            </Flex>

            <Outcome state={emailState} />

            <Flex>
              <Button type="submit" disabled={emailPending}>
                {emailPending ? "Sending confirmation…" : "Send confirmation link"}
              </Button>
            </Flex>
          </Flex>
        </form>
      </Card>

      {/* ----------------------------------------------------- change password */}
      <Card>
        <form action={passwordAction}>
          <Flex direction="column" gap="3" p="1">
            <Flex direction="column" gap="1">
              <Text weight="bold" size="3">
                Change your password
              </Text>
              <Text size="2" color="gray">
                {`Your current password is required; a signed-in browser alone isn't enough to set a new one. At least ${MIN_PASSWORD_LENGTH} characters.`}
              </Text>
            </Flex>

            <Flex direction={{ initial: "column", sm: "row" }} gap="3">
              <Flex direction="column" gap="1" flexGrow="1">
                <Text as="label" size="2" htmlFor="profile-current-password">
                  Current password
                </Text>
                <TextField.Root
                  id="profile-current-password"
                  name="current_password"
                  type="password"
                  autoComplete="current-password"
                />
              </Flex>
              <Flex direction="column" gap="1" flexGrow="1">
                <Text as="label" size="2" htmlFor="profile-new-password">
                  New password
                </Text>
                <TextField.Root
                  id="profile-new-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                />
              </Flex>
              <Flex direction="column" gap="1" flexGrow="1">
                <Text as="label" size="2" htmlFor="profile-confirm-password">
                  Repeat new password
                </Text>
                <TextField.Root
                  id="profile-confirm-password"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                />
              </Flex>
            </Flex>

            <Outcome state={passwordState} />

            <Flex>
              <Button type="submit" disabled={passwordPending}>
                {passwordPending ? "Changing…" : "Change password"}
              </Button>
            </Flex>
          </Flex>
        </form>
      </Card>

      <Separator size="4" />

      {/* -------------------------------------------------- other sessions */}
      <Card>
        <form action={revokeAction}>
          <Flex direction="column" gap="3" p="1">
            <Flex direction="column" gap="1">
              <Text weight="bold" size="3">
                Sign out everywhere else
              </Text>
              <Text size="2" color="gray">
                Ends your session on every other device and browser: a phone left at an
                FBO, a shared dispatch machine, a laptop you no longer have. This browser
                stays signed in.
              </Text>
              <Text size="1" color="gray">
                We can revoke those sessions but we can&rsquo;t list them: Supabase
                doesn&rsquo;t expose a per-device session list to the signed-in user, so
                this screen shows no device names or locations rather than inventing
                them.
              </Text>
            </Flex>

            <Flex direction={{ initial: "column", sm: "row" }} gap="3" align={{ sm: "end" }}>
              <Flex direction="column" gap="1" flexGrow="1">
                <Text as="label" size="2" htmlFor="profile-revoke-password">
                  Your current password
                </Text>
                <TextField.Root
                  id="profile-revoke-password"
                  name="current_password"
                  type="password"
                  autoComplete="current-password"
                />
              </Flex>
              <Flex>
                <Button
                  type="submit"
                  variant="outline"
                  color="red"
                  disabled={revokePending}
                >
                  {revokePending ? "Signing out…" : "Sign out other devices"}
                </Button>
              </Flex>
            </Flex>

            <Outcome state={revokeState} />
          </Flex>
        </form>
      </Card>
    </Flex>
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
        <Text size="2" color="red">
          {state.error}
        </Text>
      ) : state.notice ? (
        <Text size="2" color="green">
          {state.notice}
        </Text>
      ) : null}
    </div>
  );
}
