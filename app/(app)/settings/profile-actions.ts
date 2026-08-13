"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { reauthMessage, verifyPassword } from "@/lib/supabase/reauth";
import { looksLikeEmail } from "@/lib/email/address";
import { passwordProblem } from "@/lib/password-policy";

/**
 * PROFILE & SECURITY — the three actions that act on the signed-in PERSON
 * rather than on the business record.
 *
 * FOUR HOUSE RULES ARE DELIBERATELY BENT HERE, each for a stated reason.
 * They are listed together so a reviewer can check the reasoning in one
 * place rather than rediscovering it three times:
 *
 *  1. NO OWNER-ROLE CHECK. Every other action in this directory gates on
 *     `role !== "owner"`, because it edits the ACCOUNT — the invoice
 *     address, the day types, the accent colour. These three edit
 *     `auth.users` for the caller themself. A bookkeeper invited to an
 *     account must be able to change their own password; an owner must not
 *     be able to change theirs. Adding a role check here would be a
 *     security regression dressed as consistency.
 *
 *  2. allowReadOnly: true ON ALL THREE. requireAccount's read-only gate
 *     bounces writes from a lapsed account to Billing. That rule is about
 *     TENANT DATA — new trips, new invoices — and the promise behind it is
 *     "your records stay readable, you just stop making new ones". A
 *     pilot whose card expired must still be able to rotate a leaked
 *     password and sign a stolen laptop out. Locking identity behind a
 *     subscription would be hostile and, in the password case, dangerous.
 *
 *  3. NO count: "exact". That rule exists because PostgREST returns 200
 *     with no error for an UPDATE that matched no rows. None of these three
 *     touch PostgREST — they call GoTrue, which returns the updated user
 *     object or an error, so "wrote nothing and said nothing" is not a
 *     reachable state here. Every path below still ends in either a named
 *     success or a named failure, which is what that rule is protecting.
 *
 *  4. NO friendlyDbError. Same reason: there is no PostgrestError to
 *     translate. Auth errors are mapped by hand below, because the ones
 *     that matter (a project with Secure password change enabled; a
 *     duplicate email) each need their own sentence rather than a shared
 *     "couldn't save that".
 *
 * WHAT IS NOT BENT: the React-19 echo pattern (`values` back on every
 * failure — React resets an uncontrolled form on EVERY dispatch, the
 * rejected ones included), revalidatePath on success, and the rule that
 * every outcome is a visible specific success or a visible specific error.
 * There is no path below that returns `{ error: null, notice: null }`.
 */
export type ProfileFormState = {
  error: string | null;
  /** A specific success sentence. Never a bare "Saved." for these three. */
  notice: string | null;
  /** Echoed back so a rejected submit does not blank the form. */
  values?: Record<string, string>;
};

/** Where these actions send an unauthenticated caller back to. */
const PROFILE_PATH = "/settings?tab=profile";

/**
 * GoTrue rejects a password update with a "reauthentication" error when the
 * PROJECT has Secure password change switched on: it wants a one-time code
 * emailed by `reauthenticate()` and passed back as `nonce`. This product
 * does its own re-auth (lib/supabase/reauth.ts) and has no nonce to give,
 * so rather than surfacing GoTrue's raw wording — which tells a pilot
 * nothing they can act on — that case is named and routed to the flow that
 * does work today: the emailed reset link.
 */
function passwordUpdateMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("reauthentication") || lower.includes("nonce")) {
    return (
      "This project requires an emailed one-time code to change a password from " +
      "inside the app, which this screen can't collect yet. Sign out and use " +
      "“Forgot password” instead — that flow sets a new password end to end."
    );
  }
  if (lower.includes("same") && lower.includes("password")) {
    return "That's the password you already have. Pick a different one.";
  }
  if (lower.includes("weak") || lower.includes("short")) {
    return "Supabase rejected that password as too weak. Try a longer one.";
  }
  return `Supabase couldn't change your password: ${message}`;
}

function emailUpdateMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("already") && lower.includes("registered")) {
    // Not an enumeration oracle: the caller is already authenticated as
    // this user, and they need to know why the change won't proceed.
    return "There's already an account on that email address.";
  }
  if (lower.includes("rate") || lower.includes("too many")) {
    return "Too many change requests in a row. Wait a few minutes and try again.";
  }
  return `Supabase couldn't start the email change: ${message}`;
}

/**
 * CHANGE EMAIL.
 *
 * The single most important thing this action does is TELL THE TRUTH ABOUT
 * WHEN IT TAKES EFFECT. `updateUser({ email })` does not change the
 * sign-in address; it starts a confirmation round trip. Supabase emails the
 * new address (and, when the project has Secure email change on, the
 * current one as well), and the address only moves once every link sent has
 * been opened. Reporting "Email updated" here would be a lie a pilot could
 * lock themselves out on — they would stop using the old address believing
 * the new one works.
 *
 * The confirmation link lands on app/auth/confirm/route.ts, which already
 * accepts `type=email_change` and turns the token into a session before
 * forwarding. `emailRedirectTo` points there with a `next` back to this
 * tab, so the pilot returns to the screen they started on.
 */
export async function changeEmail(
  _prev: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const { user } = await requireAccount(PROFILE_PATH, { allowReadOnly: true });

  const email = String(formData.get("email") ?? "").trim();
  const currentPassword = String(formData.get("current_password") ?? "");
  // The password is NEVER echoed back — an echoed credential ends up in the
  // RSC payload and in the DOM. Only the address is.
  const echo = { email };

  if (!email) {
    return { error: "Enter the new email address.", notice: null, values: echo };
  }
  if (!looksLikeEmail(email)) {
    return {
      error: "That doesn't look like an email address. Check it and try again.",
      notice: null,
      values: echo,
    };
  }
  if (user.email && email.toLowerCase() === user.email.toLowerCase()) {
    return {
      error: "That's already your sign-in address.",
      notice: null,
      values: echo,
    };
  }
  if (!currentPassword) {
    return {
      error: "Enter your current password to confirm this change.",
      notice: null,
      values: echo,
    };
  }
  if (!user.email) {
    // A user with no email (a future OAuth/phone identity) has no password
    // to re-authenticate against, so this screen cannot honestly gate the
    // change. Refuse rather than let it through unchallenged.
    return {
      error:
        "This account doesn't sign in with an email and password, so this form can't change its address.",
      notice: null,
      values: echo,
    };
  }

  // RE-AUTH BEFORE ANYTHING ELSE. An attacker holding a live session must
  // not be able to move the account onto an address they control — that is
  // a permanent takeover, and it is the whole reason this step exists.
  const reauth = await verifyPassword(user.email, currentPassword);
  if (reauth !== "ok") {
    return { error: reauthMessage(reauth), notice: null, values: echo };
  }

  const origin = (await headers()).get("origin");
  const redirectTo = origin
    ? `${origin}/auth/confirm?next=${encodeURIComponent(PROFILE_PATH)}`
    : undefined;

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser(
    { email },
    // Undefined when the origin header is missing: Supabase then falls back
    // to the project's Site URL, which still lands on a working confirm
    // route. Better than fabricating an origin.
    redirectTo ? { emailRedirectTo: redirectTo } : undefined
  );

  if (error) {
    return { error: emailUpdateMessage(error.message), notice: null, values: echo };
  }

  // The pending state (user.new_email) is read on the next render, so the
  // panel can show "waiting on confirmation" rather than relying on this
  // one-shot notice surviving a reload.
  revalidatePath("/settings");
  return {
    error: null,
    notice:
      `Confirmation sent to ${email}. Your sign-in address does NOT change until that link is ` +
      `opened — keep signing in with ${user.email} until it is. If your project also confirms ` +
      `from the current address, you'll get a second link there and both must be opened.`,
    values: echo,
  };
}

/**
 * CHANGE PASSWORD.
 *
 * Re-authenticate, then update. The floor and the "not the same one"
 * rule come from lib/password-policy.ts, the same module signup and the
 * emailed reset read, so this cannot become a way around either.
 *
 * THE SUCCESS SENTENCE DELIBERATELY DOES NOT CLAIM ANYTHING ABOUT OTHER
 * DEVICES. Whether GoTrue revokes other refresh tokens on a password
 * change is a PROJECT-SIDE behaviour this repo cannot read and must not
 * guess at: asserting "your other devices are still signed in" would be a
 * lie if the project revokes them, and asserting the opposite would be a
 * lie if it doesn't — and the second lie is the dangerous one, because a
 * pilot who changed a password they think leaked would stop there. So the
 * copy states only what this action definitely did, and points at the
 * control that makes the other half certain either way.
 */
export async function changePassword(
  _prev: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const { user } = await requireAccount(PROFILE_PATH, { allowReadOnly: true });

  const currentPassword = String(formData.get("current_password") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Nothing is echoed: every field on this form is a credential.
  if (!currentPassword) {
    return { error: "Enter your current password.", notice: null };
  }
  if (!user.email) {
    return {
      error:
        "This account doesn't sign in with an email and password, so this form can't change one.",
      notice: null,
    };
  }

  const problem = passwordProblem(password, confirm, currentPassword);
  if (problem) return { error: problem, notice: null };

  const reauth = await verifyPassword(user.email, currentPassword);
  if (reauth !== "ok") {
    return { error: reauthMessage(reauth), notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: passwordUpdateMessage(error.message), notice: null };
  }

  revalidatePath("/settings");
  return {
    error: null,
    notice:
      "Password changed. You're still signed in here. If you changed it because it may have " +
      "leaked, use “Sign out everywhere else” below — that's what makes every other device " +
      "certain to be signed out.",
  };
}

/**
 * SIGN OUT EVERYWHERE ELSE.
 *
 * `signOut({ scope: "others" })` — verified present in the installed
 * @supabase/auth-js 2.111.0 (`SignOut = { scope?: 'global' | 'local' |
 * 'others' }`, GoTrueClient.signOut(options?: SignOut)). It revokes every
 * OTHER refresh token for this user and deliberately fires no sign-out
 * event on the current session, so the pilot stays where they are — which
 * is exactly the behaviour this control promises and the reason it is not
 * simply a second "Sign out" button.
 *
 * Re-authentication is required here too. Signing a colleague's device out
 * is destructive-adjacent (an in-flight edit on that device is lost), and
 * an attacker who has taken a session should not be able to evict the
 * legitimate owner from their own devices to buy time.
 */
export async function revokeOtherSessions(
  _prev: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const { user } = await requireAccount(PROFILE_PATH, { allowReadOnly: true });

  const currentPassword = String(formData.get("current_password") ?? "");
  if (!currentPassword) {
    return {
      error: "Enter your current password to sign other devices out.",
      notice: null,
    };
  }
  if (!user.email) {
    return {
      error:
        "This account doesn't sign in with an email and password, so this form can't verify you.",
      notice: null,
    };
  }

  const reauth = await verifyPassword(user.email, currentPassword);
  if (reauth !== "ok") {
    return { error: reauthMessage(reauth), notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    console.error("[auth] revoke-other-sessions failed", error.message);
    return {
      error: "Couldn't sign the other devices out just now. Try again in a moment.",
      notice: null,
    };
  }

  revalidatePath("/settings");
  return {
    error: null,
    notice:
      "Every other device has been signed out. This one is still signed in. " +
      "Anyone using another device will be asked to sign in again the next time it refreshes.",
  };
}
