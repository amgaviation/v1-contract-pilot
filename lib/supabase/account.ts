import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type AccountRow = Database["pilot"]["Tables"]["accounts"]["Row"];
type Role = Database["pilot"]["Tables"]["account_members"]["Row"]["role"];

/**
 * The signed-in identity plus the tenant it resolves to. This is the one
 * place the app turns an auth session into a `pilot.accounts` row.
 *
 * Two distinct signed-in states matter and must not be collapsed:
 *   - `account === null`  → authenticated but not provisioned. Per
 *     docs/PLAN.md decisions #6/#7 the ONLY thing that creates a tenant is
 *     the Stripe checkout webhook (Phase 2), so this is the legitimate
 *     resting state of a brand-new sign-up whose trial hasn't been set up
 *     yet — it is NOT an error, and it must NOT be worked around by
 *     minting an account here (that would be an unbilled provisioning
 *     path the plan deliberately forbids). The caller routes these users
 *     to /welcome.
 *   - `account` set       → a normal, provisioned tenant.
 */
export type SessionContext = {
  user: User;
  account: AccountRow | null;
  role: Role | null;
};

/**
 * Reads the current auth user (null when signed out). Uses getUser(), which
 * revalidates the token against Supabase rather than trusting an
 * unverified cookie — the correct call for an auth gate.
 */
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

/**
 * Resolves the signed-in user's tenant. A solo account has exactly one
 * membership row; if a user somehow belonged to more than one account
 * this returns the earliest-joined, which is a deliberate, documented
 * choice rather than an arbitrary one (multi-account switching is not a
 * Phase 1 surface). RLS guarantees the join can only ever see the caller's
 * own membership and account rows.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Two explicit queries rather than a PostgREST embed: the embed's return
  // type resolves to `never` against the generated types here, and the
  // pair reads more plainly than fighting that. RLS scopes both to the
  // caller's own rows. The result rows are cast at this boundary: recent
  // supabase-js resolves .select() against this hand-authored types file
  // to `never`, so the query builder is correct at runtime but the row
  // type must be reasserted here (regenerating database.types.ts with
  // `supabase gen types` is the central fix if this recurs on feature
  // screens).
  const { data: membershipData } = await supabase
    .from("account_members")
    .select("role, account_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const membership = membershipData as Pick<
    Database["pilot"]["Tables"]["account_members"]["Row"],
    "role" | "account_id"
  > | null;

  if (!membership) {
    return { user, account: null, role: null };
  }

  const { data: accountData } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", membership.account_id)
    .maybeSingle();

  const account = accountData as AccountRow | null;

  if (!account) {
    return { user, account: null, role: null };
  }

  return { user, account, role: membership.role };
}

/**
 * Auth-gate primitive for a provisioned surface: returns a fully-resolved
 * context or redirects. No session → /login (carrying the requested path
 * so login can bounce back). Session but no tenant → /welcome. Every
 * feature page can call this and then trust `account` is non-null.
 */
export async function requireAccount(
  redirectTo?: string
): Promise<SessionContext & { account: AccountRow; role: Role }> {
  const ctx = await getSessionContext();
  if (!ctx) {
    const next = redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : "";
    redirect(`/login${next}`);
  }
  if (!ctx.account || !ctx.role) {
    redirect("/welcome");
  }
  return ctx as SessionContext & { account: AccountRow; role: Role };
}
