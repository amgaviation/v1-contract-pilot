import "server-only";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";
import {
  choicesFor,
  labelsFor,
  type CustomOptionDomain,
  type CustomOptionRow,
  type OptionChoice,
} from "@/lib/custom-options";

/**
 * READING THE TENANT'S TAXONOMY — the server half of lib/custom-options.ts.
 *
 * Split from that module rather than folded into it for the reason
 * lib/currency/read.ts is split from the pure currency modules beside it:
 * a picker is a client component, it takes its options as a prop, and the
 * type of that prop must not drag `next/headers` into the browser bundle.
 * Everything here is `server-only`; everything decided is next door and
 * pure.
 *
 * WHY A FAILED READ RETURNS AN EMPTY ARRAY RATHER THAN THROWING. The
 * consumers are the expense form, the trip form and the document form.
 * `choicesFor` falls back to the built-in vocabulary when it is handed
 * nothing, so a settings table that is briefly unreadable costs a pilot
 * the tenant's own LABELS for one render — it does not cost them the
 * ability to file an expense. The error still reaches the server log
 * through friendlyDbError.
 */

/**
 * A bound well above any real taxonomy (the seeder plants 30 rows and
 * there is no add path yet), set explicitly so this can never become a
 * SILENTLY TRUNCATED read the way an unbounded PostgREST select can — the
 * same reasoning day-types-actions.ts records at MAX_DAY_TYPES_PER_ACCOUNT.
 * A truncated read here would drop options out of a picker with no error
 * anywhere.
 */
const MAX_CUSTOM_OPTIONS = 500;

const COLUMNS = "id, domain, key, label, sort_order, is_builtin, archived_at";

/**
 * Every option row for the caller's tenant, all three domains, ARCHIVED
 * ONES INCLUDED.
 *
 * Archived rows are deliberately in the result: they are what makes three
 * years of history keep rendering under whatever the pilot calls them
 * (labelsFor uses every row; choicesFor drops the archived ones). Any
 * caller that wants only what a picker should offer says so by calling
 * choicesFor, not by filtering here.
 *
 * RLS scopes this to the caller's account; no account_id filter is needed
 * or wanted on a plain listing select (the same note clients/page.tsx
 * carries).
 */
export async function loadCustomOptions(): Promise<CustomOptionRow[]> {
  return (await loadCustomOptionsResult()).rows;
}

/**
 * The same read, with the failure KEPT rather than swallowed.
 *
 * The empty-array fallback is right for a PICKER — a settings table that
 * is briefly unreadable costs a pilot the tenant's own LABELS for one
 * render, not the ability to file an expense. It is wrong for the
 * MANAGEMENT screen, which would otherwise print "Nothing here yet…
 * these are set up for every account automatically" over a failed read:
 * a reassuring sentence about a state that is not the state, with no
 * signal anywhere that anything is broken. A FAILED READ IS NOT AN EMPTY
 * STATE (components/ui/empty-state.tsx states the rule), so the settings
 * screen takes this variant and renders the two branches differently.
 */
export async function loadCustomOptionsResult(): Promise<{
  rows: CustomOptionRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_options")
    .select(COLUMNS)
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true })
    .limit(MAX_CUSTOM_OPTIONS);

  if (error) {
    return { rows: [], error: friendlyDbError(error, "custom_options.list") };
  }

  // Cast at the query boundary — see lib/supabase/account.ts for why
  // every select in this codebase does.
  return { rows: (data ?? []) as CustomOptionRow[], error: null };
}

/** One domain's rows, archived ones included. */
export async function loadCustomOptionsForDomain(
  domain: CustomOptionDomain
): Promise<CustomOptionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_options")
    .select(COLUMNS)
    .eq("domain", domain)
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true })
    .limit(MAX_CUSTOM_OPTIONS);

  if (error) {
    friendlyDbError(error, "custom_options.list-domain");
    return [];
  }

  return (data ?? []) as CustomOptionRow[];
}

/**
 * What one picker should offer, ready to hand a client form as a prop.
 * Never empty — see choicesFor.
 */
export async function loadOptionChoices(
  domain: CustomOptionDomain
): Promise<OptionChoice[]> {
  return choicesFor(await loadCustomOptionsForDomain(domain), domain);
}

/**
 * What one domain's stored keys are CALLED, for a list or detail screen —
 * archived options included, so a retired category still renders as its
 * name on the expenses it is filed under.
 */
export async function loadOptionLabels(
  domain: CustomOptionDomain
): Promise<Record<string, string>> {
  return labelsFor(await loadCustomOptionsForDomain(domain), domain);
}
