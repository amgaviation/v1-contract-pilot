import "server-only";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";
import {
  DEFAULT_THEME_SLOTS,
  resolveThemeSlots,
  themeForSlots,
  type ResolvedTheme,
  type ThemeSlots,
} from "@/lib/theme-slots";
import {
  DEFAULT_NAV_LAYOUT,
  normalizeNavLayout,
  type NavLayout,
} from "@/lib/nav";

/**
 * PER-TENANT PREFERENCES — the one place they are read, defaulted,
 * validated and written.
 *
 * `pilot.account_preferences` (20260813000000) is a single jsonb column
 * per account, and that migration's header explains the choice: nothing in
 * the database computes on a preference, so a column per switch would buy
 * type-checking the app does not rely on and cost a migration every time a
 * new switch is added. The database therefore guarantees exactly two
 * things — `prefs` IS a JSON object, and it is under 16 KB — and this
 * module is the entire rest of the contract.
 *
 * ===========================================================================
 * NEVER TRUST THE BLOB. VALIDATE ON READ AS WELL AS ON WRITE.
 *
 * Validating only on write is the tempting half, and it is the half that
 * breaks. The row outlives the code that wrote it: a value this build
 * accepts today can be renamed, retired or re-scoped tomorrow, and the
 * stored blob does not migrate itself. Add a restored backup, a support
 * fix applied with the service-role key, and the plain fact that the
 * column's shape is enforced by nothing, and "what is in there" is simply
 * not knowable from the writer.
 *
 * So `resolvePreferences` is TOTAL over `unknown`. Every field is checked
 * against the enumerated list that owns it — lib/theme-slots.ts for the
 * three visual slots, lib/nav.ts for the layout — and anything missing,
 * mistyped, unrecognised or stale resolves to the product's own default.
 * There is no input to this function that produces an unstyled shell, an
 * empty nav, or a throw, and there is no path that reaches a renderer
 * without going through it. That property is what lets the shell render
 * preferences at all: a preference that could break a render would not be
 * worth having.
 *
 * The writers validate too, through the SAME resolver — a write is stored
 * only in its resolved form, so a bad field is corrected before it lands
 * rather than being kept for the reader to correct forever.
 * ===========================================================================
 */

type PreferencesInsert = Database["pilot"]["Tables"]["account_preferences"]["Insert"];
type PreferencesUpdate = Database["pilot"]["Tables"]["account_preferences"]["Update"];

export type Preferences = {
  theme: ThemeSlots;
  nav: NavLayout;
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: DEFAULT_THEME_SLOTS,
  nav: DEFAULT_NAV_LAYOUT,
};

/**
 * The stored shape. Two top-level keys, each owned by the module that
 * validates it. New preferences are added as new keys here and nowhere
 * else — that is the whole point of the jsonb column.
 */
const THEME_KEY = "theme";
const NAV_KEY = "nav";

/** Untrusted jsonb → known-good preferences. Total; never throws. */
export function resolvePreferences(raw: unknown): Preferences {
  const source =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  return {
    theme: resolveThemeSlots(source[THEME_KEY]),
    nav: normalizeNavLayout(source[NAV_KEY]),
  };
}

/** Preferences → the props the app shell renders with. */
export function themeFor(preferences: Preferences): ResolvedTheme {
  return themeForSlots(preferences.theme);
}

/**
 * Reads one tenant's preferences.
 *
 * A MISSING ROW IS NOT AN ERROR, and neither is a failed read. The
 * migration seeds this table lazily on purpose — an absent row and a row
 * holding '{}' resolve identically, because this module owns the defaults
 * — so `maybeSingle` returning nothing is the ordinary state of an account
 * that has never opened the appearance screen. A read that actually FAILS
 * is treated the same way, deliberately: the alternative is a settings
 * table outage taking down every authenticated page render, and the app
 * shell is the caller. The failure is logged (friendlyDbError writes it
 * server-side) and the shell renders the product's own defaults, which is
 * exactly what it rendered before this feature existed.
 */
export async function loadPreferences(accountId: string): Promise<Preferences> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("account_preferences")
    .select("prefs")
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) {
    friendlyDbError(error, "account_preferences.load");
    return DEFAULT_PREFERENCES;
  }

  // Cast at the query boundary, the same reasoning as lib/supabase/
  // account.ts: recent supabase-js resolves a select against this
  // hand-authored types file to `never`, so the row type is reasserted
  // here. It buys nothing anyway — `prefs` is `Json`, and the resolver
  // above treats it as `unknown` regardless.
  const row = data as { prefs: unknown } | null;
  return resolvePreferences(row?.prefs);
}

/** The shell's one call: preferences straight to Theme props and grounds. */
export async function loadResolvedTheme(accountId: string): Promise<ResolvedTheme> {
  return themeFor(await loadPreferences(accountId));
}

/**
 * Writes one section of the preferences object, leaving the rest alone.
 *
 * READ-MODIFY-WRITE, and stated rather than hidden: the appearance panel
 * and the layout panel each own a disjoint key, so the only way to lose a
 * write is for one pilot to save both panels in the same instant from two
 * tabs. The cost of the alternative (a jsonb merge expression, which
 * PostgREST cannot express without an RPC) is a database function whose
 * whole job would be to serialise two writes a single-seat product makes
 * seconds apart. If seats-per-account ever makes this a real race, an RPC
 * doing `prefs = prefs || $1` is the fix.
 *
 * The candidate is passed through the resolver before it is stored, so
 * the row can only ever hold values this build recognises.
 */
async function writePreferenceSection(
  accountId: string,
  section: typeof THEME_KEY | typeof NAV_KEY,
  value: ThemeSlots | NavLayout
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: existingData, error: readError } = await supabase
    .from("account_preferences")
    .select("prefs")
    .eq("account_id", accountId)
    .maybeSingle();

  // A read failure here is NOT survivable the way the render path's is:
  // writing on top of an unknown row would silently drop the other
  // section. Refuse, and say so.
  if (readError) {
    return { error: friendlyDbError(readError, "account_preferences.read") };
  }

  const existing = (existingData as { prefs: unknown } | null)?.prefs;
  const current = resolvePreferences(existing);
  const next: Preferences =
    section === THEME_KEY
      ? { ...current, theme: value as ThemeSlots }
      : { ...current, nav: value as NavLayout };

  // Re-resolved on the way out: the stored blob is always in the shape
  // this build's readers expect, never whatever a caller happened to hand
  // in.
  const resolved = resolvePreferences({
    [THEME_KEY]: next.theme,
    [NAV_KEY]: next.nav,
  });

  const prefs = {
    [THEME_KEY]: resolved.theme,
    [NAV_KEY]: { order: [...resolved.nav.order], hidden: [...resolved.nav.hidden] },
  };

  /**
   * LOOKUP-THEN-INSERT-OR-UPDATE, NOT `.upsert()`. This is the house
   * CRITICAL on that idiom, and this table is squarely inside it.
   *
   * PostgREST compiles `.upsert()` to `ON CONFLICT (account_id) DO UPDATE
   * SET <every payload column> = excluded.<col>` — the conflict-target
   * column INCLUDED. Postgres checks UPDATE privilege on every column
   * named in that SET list STATICALLY, at executor start, before any
   * conflict is evaluated and even when the incoming value equals the
   * stored one. 20260813000000 grants `authenticated` only
   * `insert (account_id, prefs)` and `update (prefs)`: `account_id` is the
   * tenancy key and is deliberately NOT UPDATE-grantable, so the compiled
   * statement is refused with 42501 (insufficient_privilege) on the first
   * save and on every later one. friendlyDbError would turn that into a
   * generic sentence and the appearance and layout panels would never
   * persist anything.
   *
   * scripts/tenancy-verify.mjs replays exactly this shape against
   * pilot.guarantee_periods and ASSERTS the 42501 (case C2a); the same
   * fix is already written out at app/(app)/invoices/actions.ts,
   * app/(app)/trips/actions.ts, app/(app)/settings/mileage-rates-actions.ts
   * and app/(app)/clients/[id]/rate-overrides-actions.ts.
   *
   * Widening the grant to `update (account_id)` would also make the
   * statement legal, and is the wrong direction: it would make the
   * tenancy key tenant-updatable to buy back one round trip this function
   * has already made anyway.
   *
   * `existingData` above is already in hand, so the branch is free. Both
   * statements below name only granted columns.
   */
  if (existingData) {
    const updatePayload: PreferencesUpdate = { prefs };
    const { error, count } = await supabase
      .from("account_preferences")
      .update(updatePayload as never, { count: "exact" })
      .eq("account_id", accountId);

    if (error) {
      return { error: friendlyDbError(error, "account_preferences.update") };
    }
    // PostgREST returns 200 with no error for a write that matched nothing.
    if (count === 0) {
      return { error: "Couldn't save that. Try again." };
    }
    return { error: null };
  }

  const insertPayload: PreferencesInsert = { account_id: accountId, prefs };
  const { error: insertError, count: insertCount } = await supabase
    .from("account_preferences")
    .insert(insertPayload as never, { count: "exact" });

  if (insertError) {
    // 23505 — the row was created between this function's read and its
    // insert (two tabs, or the layout panel and the appearance panel
    // saving in the same instant). That is a lost race, not a failure to
    // report: retry as the update it should have been. There is no
    // DELETE policy on this table, so the row cannot vanish again and the
    // retry cannot loop.
    if (insertError.code === "23505") {
      const retryPayload: PreferencesUpdate = { prefs };
      const { error: retryError, count: retryCount } = await supabase
        .from("account_preferences")
        .update(retryPayload as never, { count: "exact" })
        .eq("account_id", accountId);

      if (retryError) {
        return { error: friendlyDbError(retryError, "account_preferences.update") };
      }
      if (retryCount === 0) {
        return { error: "Couldn't save that. Try again." };
      }
      return { error: null };
    }
    return { error: friendlyDbError(insertError, "account_preferences.insert") };
  }
  if (insertCount === 0) {
    return { error: "Couldn't save that. Try again." };
  }

  return { error: null };
}

export async function saveThemeSlots(
  accountId: string,
  slots: ThemeSlots
): Promise<{ error: string | null }> {
  return writePreferenceSection(accountId, THEME_KEY, resolveThemeSlots(slots));
}

export async function saveNavLayout(
  accountId: string,
  layout: NavLayout
): Promise<{ error: string | null }> {
  return writePreferenceSection(accountId, NAV_KEY, normalizeNavLayout(layout));
}
