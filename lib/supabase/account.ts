import "server-only";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { accountIsReadOnly } from "@/lib/entitlements";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type AccountRow = Database["pilot"]["Tables"]["accounts"]["Row"];
type Role = Database["pilot"]["Tables"]["account_members"]["Row"]["role"];

/** Where a refused write sends the pilot — Billing, to resubscribe. */
const READ_ONLY_REDIRECT = "/settings/billing?state=read-only";

/**
 * The post-checkout onboarding wizard (app/(onboarding)/onboarding). A
 * provisioned account whose owner has not finished it yet is bounced here on
 * every request until they do — see requireAccount's `allowUnonboarded`. It
 * lives in its OWN route group, not under (app), precisely so this redirect
 * cannot loop: the (app) gate sends an un-onboarded pilot out of the app
 * shell and into a group whose own gate passes `allowUnonboarded`.
 */
const ONBOARDING_PATH = "/onboarding";

/**
 * True when this render is actually a MUTATING Server Action invocation
 * rather than a page/data read. This is the whole hinge of the read-only
 * gate: a canceled account must still be able to LOAD every page and hit
 * every export (both GET), while its WRITES (Server Actions, always POST)
 * are refused.
 *
 * HOW IT TELLS THEM APART, verified against the installed Next 16.2.12
 * source (node_modules/next/dist/server/lib/server-action-request-meta.js
 * and .../client/components/app-router-headers.js): Next dispatches a
 * Server Action as a POST carrying either the `next-action` header (the
 * fetch/JS path, ACTION_HEADER = 'next-action') or a form content-type
 * (multipart/form-data or application/x-www-form-urlencoded — the no-JS
 * progressive-enhancement path, where the action id rides the body).
 * A GET page render, an RSC navigation, and a prefetch carry NONE of
 * these, so a READ can never trip this predicate — the property the whole
 * design leans on. It can only ever FAIL CLOSED toward reads (worst case
 * a stray form POST that is not an action is treated as a write and
 * redirected), never open a write it should have refused.
 *
 * KNOWN EDGE, documented not hidden: a hand-crafted POST to a page URL
 * with no action metadata is not a Server Action and Next would not run
 * one; it is caught by the content-type arm only if it looks like a form
 * post, which is the safe direction anyway.
 */
async function isMutatingRequest(): Promise<boolean> {
  const h = await headers();
  if (h.has("next-action")) return true;
  const contentType = h.get("content-type") ?? "";
  return (
    contentType.startsWith("multipart/form-data") ||
    contentType.startsWith("application/x-www-form-urlencoded")
  );
}

/**
 * READ-ONLY-ON-LAPSE, stated once (docs/PRICING.md §5): a canceled or
 * lapsed account keeps every record readable and exportable — deleted
 * never — but stops creating new work. `account.status` outside
 * ACCOUNT_WRITABLE_STATUSES (lib/entitlements.ts) means read-only.
 */
// accountIsReadOnly now lives in lib/entitlements.ts, beside the
// ACCOUNT_WRITABLE_STATUSES allow-list it reads and the deactivated_at rule
// it also has to apply — pure, and unit-testable without this module's
// next/navigation and server-only imports. Re-exported so every existing
// call site is unchanged.
export { accountIsReadOnly };

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
 *
 * READ-ONLY ENFORCEMENT (Finding 3, docs/PRICING.md §5). This is the ONE
 * seam every mutation entry point already passes through — every server
 * action calls requireAccount (directly, or via requireEntitlement, which
 * delegates here), and so does the (app) layout on every request. So the
 * gate lives HERE, once, rather than being swept across ~two dozen action
 * files (several of them owned by other workstreams): when the account is
 * NOT writable (canceled / past_due / any status outside
 * ACCOUNT_WRITABLE_STATUSES) AND the current request is a MUTATING Server
 * Action, the write is refused and the pilot is sent to Billing to
 * resubscribe. A page RENDER (GET) is never a mutating request, so a
 * read-only account still loads every page and reaches every export — the
 * product's promise that a lapse never destroys or hides records.
 *
 * `allowReadOnly` is the deliberate opt-out for the RESUBSCRIBE path
 * itself (settings/billing's changePlan and openBillingPortal): those
 * must run for a lapsed account, or it could never get back to writable.
 * They are the only callers that pass it.
 *
 * WHAT THIS IS AND IS NOT. It is the data-integrity floor: every write
 * refuses for a lapsed account, and the account-status notice renders
 * (the (app) layout banner + the Billing page). It is NOT a full
 * read-only UX polish — inputs are not individually disabled and buttons
 * are not greyed per-screen; a write is attempted and cleanly bounced
 * rather than pre-empted in the UI. See the report/PR notes for exactly
 * what a fuller polish would add.
 */
export async function requireAccount(
  redirectTo?: string,
  options?: { allowReadOnly?: boolean; allowUnonboarded?: boolean }
): Promise<SessionContext & { account: AccountRow; role: Role }> {
  const ctx = await getSessionContext();
  if (!ctx) {
    const next = redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : "";
    redirect(`/login${next}`);
  }
  if (!ctx.account || !ctx.role) {
    redirect("/welcome");
  }
  // ONBOARDING GATE. A provisioned account that has not finished the wizard
  // is sent into it on EVERY request — read or write, no isMutatingRequest
  // check — until onboarding_complete flips true. Unconditional because a
  // half-set-up account should not be able to browse the app around the
  // wizard. The wizard's own route group passes allowUnonboarded so it, and
  // only it, renders for such an account. Ordered before the read-only gate:
  // a freshly-provisioned account is trialing (writable), so the two never
  // contend in practice, and "finish setup" is the more specific state.
  if (!options?.allowUnonboarded && !ctx.account.onboarding_complete) {
    redirect(ONBOARDING_PATH);
  }
  if (
    !options?.allowReadOnly &&
    accountIsReadOnly(ctx.account) &&
    (await isMutatingRequest())
  ) {
    redirect(READ_ONLY_REDIRECT);
  }
  return ctx as SessionContext & { account: AccountRow; role: Role };
}

/**
 * Explicit write gate for a mutation entry point that wants to state its
 * intent in one word rather than rely on the ambient detection in
 * requireAccount. Behaviourally identical for a mutating request (both
 * refuse a read-only account); the difference is documentary. A new
 * server action can call this instead of requireAccount to make "this is
 * a write" legible at the call site.
 */
export async function requireWritableAccount(
  redirectTo?: string
): Promise<SessionContext & { account: AccountRow; role: Role }> {
  return requireAccount(redirectTo);
}
