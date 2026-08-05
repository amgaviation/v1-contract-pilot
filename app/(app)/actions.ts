"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session and returns the user to the login surface. Passed into
 * the client AppShell as a form action so the sign-out control lives in
 * the dashboard chrome without that client component needing to import a
 * Supabase client itself.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
