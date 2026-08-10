import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/account";
import { DASHBOARD_PATH } from "@/lib/nav";
import SignUpForm from "./signup-form";

export const metadata = { title: "Create your account" };

export default async function SignUpPage() {
  const ctx = await getSessionContext();
  if (ctx?.account) redirect(DASHBOARD_PATH);
  if (ctx) redirect("/welcome");

  return <SignUpForm />;
}
