"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session and returns the user to the login surface. Passed into
 * the header as a form action so the sign-out control lives in the
 * dashboard chrome without that chrome needing a Supabase client itself.
 *
 * `scope: "local"` IS A FIX, NOT A TWEAK. supabase-js's `signOut()`
 * defaults to scope "global" — verified in the installed
 * @supabase/auth-js 2.111.0, whose own doc block on GoTrueClient.signOut
 * reads "By default, `signOut()` uses the **global** scope, which signs
 * out the user from all sessions". So this plain header button was
 * silently revoking every OTHER device's session as well: a pilot signing
 * out of a shared dispatch computer at an FBO was also signing out their
 * phone, with nothing on screen saying so. A control labelled "Sign out"
 * must end THIS session and no other.
 *
 * Signing every device out is still available — deliberately, explicitly,
 * behind a password check, and with its consequence spelled out — at
 * Settings → Profile & security ("Sign out everywhere else", see
 * app/(app)/settings/profile-actions.ts). They are now two controls doing
 * two things instead of one control quietly doing both.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
