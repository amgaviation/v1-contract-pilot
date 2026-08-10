import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/account";
import LoginForm from "./login-form";
import { safeNextPath } from "@/lib/safe-next";

export const metadata = { title: "Sign in" };

/**
 * Already-signed-in users don't belong on the login page: send them to the
 * app (provisioned) or /welcome (no tenant yet). Otherwise render the form,
 * threading through a `next` path so a user deep-linked into a gated page
 * lands back there after signing in.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const ctx = await getSessionContext();
  if (ctx?.account) redirect("/");
  if (ctx) redirect("/welcome");

  const { next } = await searchParams;
  const target = safeNextPath(next);

  return <LoginForm next={target} />;
}
