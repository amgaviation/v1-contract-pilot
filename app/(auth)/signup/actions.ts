"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { looksLikeEmail } from "@/lib/email/address";
import { passwordProblem } from "@/lib/password-policy";
import {
  PENDING_SIGNUP_COOKIE,
  PENDING_SIGNUP_MAX_AGE_SECONDS,
} from "@/lib/auth/confirmation";
import { classifySignUpError } from "@/lib/auth/signup-outcome";

export type SignUpState = { error: string | null };

/**
 * THE ONE LANDING FOR EVERY ADDRESS THAT NEEDS CONFIRMING, whether this
 * call created an account or the address already had one.
 *
 * It is a function rather than two copies precisely so the two paths cannot
 * drift: a different cookie, a different destination, or an extra branch on
 * one side of the pair is what would turn this screen back into the account
 * enumeration oracle it used to be. See lib/auth/signup-outcome.ts for what
 * Supabase returns in each case and what remains observable.
 *
 * THE ADDRESS TRAVELS IN AN httpOnly COOKIE, NOT A QUERY STRING. Set here,
 * by the action that actually asked for the mail, so /check-email can vouch
 * for what it prints. See lib/auth/confirmation.ts for the full reasoning,
 * including the phishing shape a writable ?email= would hand out on this
 * product's own domain.
 */
async function toCheckEmail(email: string): Promise<never> {
  const cookieStore = await cookies();
  cookieStore.set(PENDING_SIGNUP_COOKIE, email, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: PENDING_SIGNUP_MAX_AGE_SECONDS,
    path: "/",
  });
  redirect("/check-email");
}

export async function signUp(
  _prev: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  // Constrain the account-type toggle to the two known values rather than
  // trusting the posted string: it seeds accounts.kind at provisioning, so
  // an unexpected value would violate that column's CHECK. Anything that
  // isn't "business" falls back to "solo" — the floor, same rule the
  // webhook uses.
  const accountKind =
    String(formData.get("account_kind") ?? "") === "business"
      ? "business"
      : "solo";
  const homeBase = String(formData.get("home_base") ?? "").trim().toUpperCase();

  if (!email || !password) {
    return { error: "Enter your email and a password." };
  }
  if (!fullName) {
    return { error: "Enter your name so we can set up your account." };
  }
  // A fact about what was typed, not about who exists, so it stays specific.
  if (!looksLikeEmail(email)) {
    return {
      error: "That doesn't look like an email address. Check it and try again.",
    };
  }
  // The rules live in lib/password-policy.ts, which is also where the
  // emailed reset and the signed-in change form read them. The hand-rolled
  // `password.length < 8` this replaced silently missed the 72-byte bcrypt
  // truncation guard, which is the exact staleness that file exists to
  // prevent. This form has one password field, so `confirm` is the same
  // string.
  const problem = passwordProblem(password, password);
  if (problem) {
    return { error: problem };
  }

  // WHERE THE CONFIRMATION LINK LANDS. Without an explicit
  // emailRedirectTo, Supabase builds the link from the PROJECT's Site URL,
  // which is a dashboard setting this repo cannot read: the link would open
  // whatever that happens to point at, never /auth/confirm, so the token
  // would never be exchanged and the pilot would never get a session. Named
  // here so the destination is a fact of this codebase.
  //
  // Built exactly the way profile-actions.ts's changeEmail builds it, so
  // there is one way of doing this and not two. Undefined when the Origin
  // header is missing: Supabase then falls back to the Site URL, which is
  // the status quo rather than a fabricated origin.
  const origin = (await headers()).get("origin");
  const emailRedirectTo = origin
    ? `${origin}/auth/confirm?next=${encodeURIComponent("/welcome")}`
    : undefined;

  const supabase = await createClient();
  // The identity fields ride in user_metadata (Supabase's raw_user_meta_data).
  // This is PREFILL for provisioning, never an authorization input — the
  // webhook reads it once to name the account and seed kind/home_base, and
  // nothing in an RLS policy or entitlement check ever consults it. (The
  // account's real kind lives in pilot.accounts, service_role-written; see
  // lib/stripe/provisioning.ts.)
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        account_kind: accountKind,
        home_base: homeBase || null,
      },
      // The confirmed pilot ends at /welcome, which is where the trial
      // checkout lives. /auth/confirm mints the session from the token and
      // then forwards there, so no separate "you are confirmed" screen
      // exists or is needed.
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    },
  });

  if (error) {
    // NEVER error.message, which is what this line used to be. Supabase's
    // own wording for a taken address ("User already registered") turned
    // this public form into a membership test against every pilot's email.
    // The classifier decides what may be said; the raw text is logged for
    // whoever is on call and never rendered.
    const outcome = classifySignUpError(error.code, error.status, error.message);
    console.error("[auth] signUp failed", error.code ?? "no code", error.status ?? "no status", error.message);
    if (outcome.kind === "pending-confirmation") {
      // The address is taken. Same cookie, same destination, same screen a
      // brand new signup gets: nothing here tells the caller which of the
      // two happened. No account was created and no mail was sent, so
      // /check-email's resend control is the honest way forward for the
      // person who actually owns the address.
      await toCheckEmail(email);
      // Unreachable: toCheckEmail always redirects, which throws. Present
      // so the outcome narrows here without restructuring the branch.
      return { error: null };
    }
    return { error: outcome.message };
  }

  // When email confirmation is enabled on the Supabase project, signUp
  // returns a user with no session: the pilot must click the link before
  // they can do anything. An address that ALREADY has an account returns
  // this same shape, deliberately, on Supabase's side (see
  // lib/auth/signup-outcome.ts), so this branch is already the
  // indistinguishable one and needs no help from us.
  //
  // The state is a screen of its own (/check-email) rather than a panel
  // swapped into this form, because there is nothing left to do on the form
  // and it has to survive a reload, which an in-memory action state does
  // not.
  if (!data.session) {
    await toCheckEmail(email);
  }

  // Session established: they're authenticated but have no tenant yet, so
  // /welcome (which offers the trial checkout) is the right landing spot.
  redirect("/welcome");
}
