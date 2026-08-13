"use server";

/**
 * Saving and deleting a named logbook filter.
 *
 * WHAT A VIEW IS AND IS NOT: a stored question, never a stored answer.
 * Nothing here caches a total, a count or a date range's result — the
 * figures a filtered logbook shows are recomputed in the database on every
 * render (pilot.logbook_filtered_totals), so a view cannot go stale and a
 * pilot can never be shown a number from before their last flight. See
 * lib/logbook-views.ts's header for the rest of the design.
 *
 * House discipline, none of it decorative:
 *   - requireAccount() on both actions, which is also the read-only gate —
 *     a lapsed account's writes bounce to Billing from inside it.
 *   - the whole list is validated through the SAME total resolver the
 *     reader uses, on the way in as well as on the way out, so the stored
 *     blob can only ever hold views this build recognises.
 *   - `values` echoed back on failure: React 19 calls native form.reset()
 *     on EVERY action dispatch, the error path included, so without this
 *     one rejected name blanks the filter the pilot was trying to save.
 *
 * NO OWNER-ROLE CHECK, unlike the appearance and taxonomy panels. Those
 * change what the whole account looks like or how its records are filed;
 * a saved logbook filter changes what one person sees on one screen and
 * touches no record. Gating it on ownership would stop a second seat from
 * bookmarking their own view of their own logbook.
 */

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/supabase/account";
import { loadPreferences, saveLogbookViews } from "@/lib/preferences";
import {
  removeLogbookView,
  resolveLogbookFilter,
  saveLogbookView,
  type LogbookFilter,
} from "@/lib/logbook-views";

export type LogbookViewFormState = {
  error: string | null;
  saved?: true;
  values?: Record<string, string>;
};

const FIELDS = ["name", "tail", "type", "role", "from", "to"] as const;

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

/**
 * The filter carried on the form — the one the pilot is looking at,
 * re-validated here rather than trusted. A server action is a public POST
 * endpoint; the hidden inputs that carry the filter are as untrusted as a
 * hand-edited URL, and resolveLogbookFilter is total over both.
 */
function filterFrom(formData: FormData): LogbookFilter {
  return resolveLogbookFilter({
    tail: String(formData.get("tail") ?? ""),
    type: String(formData.get("type") ?? ""),
    role: String(formData.get("role") ?? ""),
    from: String(formData.get("from") ?? ""),
    to: String(formData.get("to") ?? ""),
  });
}

export async function saveLogbookViewAction(
  _prev: LogbookViewFormState,
  formData: FormData
): Promise<LogbookViewFormState> {
  const { account } = await requireAccount("/logbook");

  // READ-MODIFY-WRITE against the list as it stands right now, not against
  // whatever the page was rendered with. The window in which two tabs can
  // lose each other's view is then one round trip wide rather than however
  // long the pilot left the screen open. lib/preferences.ts's own header
  // works through why that is the accepted trade here and what the fix
  // would be if seats-per-account ever made it a real race.
  const preferences = await loadPreferences(account.id);

  const result = saveLogbookView(
    preferences.logbookViews,
    String(formData.get("name") ?? ""),
    filterFrom(formData)
  );
  if (!result.ok) {
    return { error: result.error, values: echo(formData) };
  }

  const { error } = await saveLogbookViews(account.id, result.views);
  if (error) return { error, values: echo(formData) };

  revalidatePath("/logbook");
  return { error: null, saved: true };
}

/**
 * Delete by name — the key, per lib/logbook-views.ts. Idempotent: removing
 * a view that is already gone is a no-op rather than an error, so a
 * double-submit or a stale tab does not produce a failure message about
 * something the pilot already got what they wanted from.
 */
export async function deleteLogbookViewAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "");
  if (name.trim() === "") return;

  const { account } = await requireAccount("/logbook");
  const preferences = await loadPreferences(account.id);
  const next = removeLogbookView(preferences.logbookViews, name);

  // Nothing to write if nothing matched. Skipping the write also means a
  // stray delete cannot rewrite (and so re-normalise) the stored blob for
  // no reason.
  if (next.length === preferences.logbookViews.length) return;

  // A FAILED DELETE IS NOT A DELETE. Revalidating regardless re-rendered
  // /logbook with the view still on it and nothing said — the pilot clicks
  // the X, the chip stays, and clicking again repeats the silent failure.
  // This is one small button per chip rather than a useActionState form
  // (the save form is where that machinery earns its keep), so the honest
  // minimum is: never revalidate a write that did not happen, and leave a
  // tagged trace for whoever is asked why the chip will not go away.
  const { error } = await saveLogbookViews(account.id, next);
  if (error) {
    console.error("[logbook views] delete failed to write", error);
    return;
  }

  revalidatePath("/logbook");
}
