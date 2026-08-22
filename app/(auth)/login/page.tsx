import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/account";
import { DASHBOARD_PATH } from "@/lib/nav";
import LoginForm from "./login-form";
import { safeNextPath } from "@/lib/safe-next";

export const metadata = { title: "Sign in" };

/**
 * Already-signed-in users don't belong on the login page: send them to the
 * app (provisioned) or /welcome (no tenant yet). Otherwise render the form,
 * threading through a `next` path so a user deep-linked into a gated page
 * lands back there after signing in.
 *
 * `deleted=1` IS THE END OF THE ACCOUNT-DELETION FLOW. deleteAccount()
 * (app/(app)/settings/account-actions.ts) signs the session out and sends
 * the pilot here, and this is the only place that tells them the delete
 * actually happened. It is display-only and trusted for nothing: a stranger
 * who types the parameter sees a sentence, not a state change. The session
 * check above already ran, so anyone reaching the form is signed out
 * regardless of what the query string says.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; deleted?: string }>;
}) {
  const ctx = await getSessionContext();
  if (ctx?.account) redirect(DASHBOARD_PATH);
  if (ctx) redirect("/welcome");

  const { next, deleted } = await searchParams;
  const target = safeNextPath(next);

  return <LoginForm next={target} deleted={deleted === "1"} />;
}
