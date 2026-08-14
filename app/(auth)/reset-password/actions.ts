"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DASHBOARD_PATH } from "@/lib/nav";
import { passwordProblem } from "@/lib/password-policy";
import { RECOVERY_PROOF_COOKIE } from "@/lib/supabase/reauth";

export type ResetPasswordState = { error: string | null };

export async function setNewPassword(
  _prev: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // The one place the rules live — see lib/password-policy.ts's header for
  // why hand-rolling `password.length < 8` here (as this used to) is
  // exactly the staleness that file exists to prevent: it also carries the
  // 72-byte bcrypt-truncation guard, which a hand-rolled check would miss.
  const problem = passwordProblem(password, confirm);
  if (problem) {
    return { error: problem };
  }

  const supabase = await createClient();

  // updateUser acts on the session the recovery link established. Without
  // one there is nothing to update, and re-checking here rather than
  // trusting the page's own check keeps the action safe on its own — a
  // server action is a public endpoint, not a private helper of the page
  // that renders the form.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: "That reset link has expired. Request a new one to continue.",
    };
  }

  // THE RE-AUTHENTICATION GATE. A session existing is not proof it came
  // from a recovery link — see lib/supabase/reauth.ts's
  // RECOVERY_PROOF_COOKIE doc. Without this check, anyone holding a live
  // session (a stolen cookie, an unattended laptop) could reach this action
  // directly and set a new password with zero challenge, which is the
  // hijacked-session takeover this gate exists to close.
  const cookieStore = await cookies();
  const hasRecoveryProof = Boolean(cookieStore.get(RECOVERY_PROOF_COOKIE)?.value);
  if (!hasRecoveryProof) {
    return {
      error:
        "This link has already been used or has expired. Request a new " +
        "reset link, or use Settings → Profile & security to change your " +
        "password while signed in.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }

  // The proof is single-use: cleared the moment it does its job, so the
  // same recovery session cannot set a second password later in its
  // window without going back through the emailed link.
  cookieStore.delete(RECOVERY_PROOF_COOKIE);

  // This is the flow a pilot uses when they suspect compromise, so an
  // attacker's session must not be able to survive the very reset performed
  // to evict it. `scope: "others"` revokes every OTHER refresh token for
  // this user and fires no sign-out event on this one — see
  // profile-actions.ts's changePassword for the same call and its full
  // rationale. Logged, not surfaced: a failure here must not block the
  // password change that already succeeded.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
  if (signOutError) {
    console.error("[auth] reset-password revoke-other-sessions failed", signOutError.message);
  }

  redirect(DASHBOARD_PATH);
}
