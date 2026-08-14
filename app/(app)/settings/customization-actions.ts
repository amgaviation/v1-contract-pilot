"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import {
  saveMessageTemplates as persistMessageTemplates,
  saveNavLayout,
  saveThemeSlots,
} from "@/lib/preferences";
import {
  INVOICE_PLACEHOLDERS,
  REMINDER_PLACEHOLDERS,
} from "@/lib/email/invoice-message";
import { messageTemplateProblem } from "@/lib/message-templates";
import {
  isThemeAccent,
  isThemeAppearance,
  isThemeDensity,
  type ThemeSlots,
} from "@/lib/theme-slots";
import { NAV_SECTIONS, NAV_SETTINGS, normalizeNavLayout } from "@/lib/nav";
import {
  isCustomOptionDomain,
  rowsForDomain,
  type CustomOptionDomain,
  type CustomOptionRow,
} from "@/lib/custom-options";
import type { Database } from "@/lib/supabase/database.types";

type CustomOptionUpdate = Database["pilot"]["Tables"]["custom_options"]["Update"];

/**
 * The three customisation panels' server actions.
 *
 * House discipline throughout, and none of it is decorative:
 *   - requireAccount() on every action, which is also the read-only gate
 *     (a lapsed account's writes bounce to Billing from inside it).
 *   - an owner-role check with the same message shape settings/actions.ts
 *     and day-types-actions.ts use. Like those, this is for the MESSAGE:
 *     the RLS policies on both tables are "any member of the account", so
 *     the database boundary is the policy and the grant, and this is the
 *     product decision that appearance and taxonomy are the owner's.
 *   - count: "exact" on every write, because PostgREST returns 200 with no
 *     error for an UPDATE that matched nothing.
 *   - friendlyDbError for anything unexpected, so a constraint name or a
 *     withheld column never reaches a pilot.
 *   - `values` echoed back on failure: React 19 resets an uncontrolled
 *     form on EVERY action dispatch, the error path included.
 */
export type CustomizationFormState = {
  error: string | null;
  saved?: boolean;
  values?: Record<string, string>;
};

/**
 * Every screen whose PICKER or LABELS come from a domain's options.
 * Renaming a category has to reach the list screens too, not just the
 * form — that is the whole point of an archived option still rendering in
 * history.
 */
const DOMAIN_PATHS: Record<CustomOptionDomain, readonly string[]> = {
  expense_category: ["/expenses", "/expenses/transactions"],
  trip_kind: ["/trips"],
  document_kind: ["/documents"],
};

const DOMAIN_DETAIL_PATHS: Record<CustomOptionDomain, readonly string[]> = {
  expense_category: ["/expenses/[id]"],
  trip_kind: ["/trips/[id]"],
  document_kind: ["/documents/[id]"],
};

function revalidateDomain(domain: CustomOptionDomain) {
  revalidatePath("/settings");
  for (const path of DOMAIN_PATHS[domain]) revalidatePath(path);
  for (const path of DOMAIN_DETAIL_PATHS[domain]) revalidatePath(path, "page");
}

// ---------------------------------------------------------------------------
// APPEARANCE
// ---------------------------------------------------------------------------

/**
 * Validated field by field against lib/theme-slots.ts's enumerated lists —
 * the same functions the READER uses. A posted value that is not one of
 * them is refused here rather than silently defaulted, because unlike a
 * stored blob (which may predate this build and legitimately hold
 * anything) a form post that names an unknown accent is a bug or a probe,
 * and answering it with "saved!" while storing something else would be
 * worse than refusing.
 */
export async function saveAppearance(
  _prev: CustomizationFormState,
  formData: FormData
): Promise<CustomizationFormState> {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can change how this account looks." };
  }

  const accent = String(formData.get("accent") ?? "");
  const density = String(formData.get("density") ?? "");
  const appearance = String(formData.get("appearance") ?? "");
  const echo = { accent, density, appearance };

  if (!isThemeAccent(accent)) {
    return { error: "Pick one of the accent colours shown.", values: echo };
  }
  if (!isThemeDensity(density)) {
    return { error: "Pick either Compact or Comfortable.", values: echo };
  }
  if (!isThemeAppearance(appearance)) {
    return { error: "Pick either Light or Dark.", values: echo };
  }

  const slots: ThemeSlots = { accent, density, appearance };
  const { error } = await saveThemeSlots(account.id, slots);
  if (error) return { error, values: echo };

  // "layout", not a page: the theme lives on the (app) layout, so every
  // authenticated screen has to re-render for the change to be visible.
  // This is the one revalidatePath("/") form tests/dashboard-path.test.mjs
  // deliberately permits — it is a whole-tree invalidation rooted at the
  // root layout, not a reference to the dashboard page.
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}

// ---------------------------------------------------------------------------
// LAYOUT
// ---------------------------------------------------------------------------

/**
 * The layout panel posts the whole arrangement at once: `order` as one
 * newline-separated field of hrefs (the list the pilot has been moving up
 * and down), and one `hidden` checkbox per section.
 *
 * Both are then put through normalizeNavLayout, the same total function
 * the reader uses — so an href that no longer exists, a duplicate, or an
 * attempt to hide /settings is dropped rather than stored. The panel does
 * not offer Settings at all; this is what makes that a rule rather than a
 * UI convention.
 */
export async function saveNavArrangement(
  _prev: CustomizationFormState,
  formData: FormData
): Promise<CustomizationFormState> {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can change the navigation." };
  }

  const order = String(formData.get("order") ?? "")
    .split("\n")
    .map((href) => href.trim())
    .filter((href) => href !== "");
  const hidden = formData.getAll("hidden").map((value) => String(value));

  const layout = normalizeNavLayout({ order, hidden });

  // A cheap sanity check with a sentence attached, before the write: it is
  // legitimate to hide everything (Settings always renders below the
  // separator, so the pilot can always get back here), but it is almost
  // never what someone meant to do.
  if (
    layout.hidden.length >= NAV_SECTIONS.length &&
    NAV_SECTIONS.length > 0
  ) {
    return {
      error:
        `Keep at least one section visible. ${NAV_SETTINGS.label} always stays, ` +
        `but a rail with nothing else in it is almost certainly not what you meant.`,
    };
  }

  const { error } = await saveNavLayout(account.id, layout);
  if (error) return { error };

  revalidatePath("/", "layout");
  return { error: null, saved: true };
}

// ---------------------------------------------------------------------------
// MESSAGE WORDING (the reusable invoice / reminder templates)
// ---------------------------------------------------------------------------

/**
 * The one screen where a pilot writes words their CLIENT will read.
 *
 * That makes the validation here different in kind from the appearance
 * panel's above. An unknown accent is a bug or a probe and is refused
 * flatly; an unknown PLACEHOLDER is a typo — `{{client}}` for
 * `{{client_name}}` — made by someone composing a sentence, and the only
 * moment it can be caught before an operator's accounts-payable desk reads
 * the result is right here. So the refusal names the offending token and
 * lists the ones that work (messageTemplateProblem), rather than saying
 * "that isn't valid".
 *
 * BLANK IS A REAL CHOICE, NOT A MISSING VALUE. An empty box stores null,
 * which means "use the built-in wording" — the state every account is in
 * until it opens this panel, and the way back for a pilot who tried a
 * template and preferred the product's own sentence. There is deliberately
 * no separate "reset" control: clearing the field IS the reset, and it
 * behaves identically to never having saved anything.
 *
 * Both templates are written in ONE action because they share one jsonb
 * section and one read-modify-write (lib/preferences.ts). Saving them
 * separately would be two round trips racing each other over the same key
 * for no benefit — the panel shows them together and the pilot edits them
 * together.
 */
export async function saveMessageTemplates(
  _prev: CustomizationFormState,
  formData: FormData
): Promise<CustomizationFormState> {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return {
      error: "Only the account owner can change the wording your clients receive.",
    };
  }

  const invoice = String(formData.get("invoice_template") ?? "").trim();
  const reminder = String(formData.get("reminder_template") ?? "").trim();
  // Echoed on EVERY failure path: React 19 resets an uncontrolled form on
  // every action dispatch, the error path included, and losing a
  // half-written paragraph to a typo in the other box is the exact
  // frustration this discipline exists to prevent.
  const echo = { invoice_template: invoice, reminder_template: reminder };

  if (invoice) {
    const problem = messageTemplateProblem(invoice, INVOICE_PLACEHOLDERS);
    if (problem) return { error: `Invoice message: ${problem}`, values: echo };
  }
  if (reminder) {
    const problem = messageTemplateProblem(reminder, REMINDER_PLACEHOLDERS);
    if (problem) return { error: `Reminder: ${problem}`, values: echo };
  }

  const { error } = await persistMessageTemplates(account.id, {
    invoice: invoice === "" ? null : invoice,
    reminder: reminder === "" ? null : reminder,
  });
  if (error) return { error, values: echo };

  // Only /settings: unlike the appearance and layout sections, nothing
  // outside this screen RENDERS a template. It is read at send time by
  // app/(app)/invoices/actions.ts, from the database, on a request that
  // starts after this one finishes — so there is no cached tree anywhere
  // holding a stale copy, and a "/" layout revalidation would be a
  // whole-tree invalidation bought for nothing.
  revalidatePath("/settings");
  return { error: null, saved: true };
}

// ---------------------------------------------------------------------------
// CATEGORIES (custom_options)
// ---------------------------------------------------------------------------

const MAX_OPTION_LABEL = 80;

/**
 * The domain's rows in exactly the order the panel renders them. Bounded
 * explicitly so a reorder can never operate on a silently truncated read
 * — renumbering a partial list would scramble the rest.
 *
 * SCOPED TO THE ACTING ACCOUNT, not merely to what RLS admits, and that
 * is not belt-and-braces here: the WRITES below carry
 * `.eq("account_id", account.id)`, so a read that returned more than that
 * one tenant's rows would renumber a merged list and then abort part-way
 * through it, leaving this account's sort_order half-rewritten. RLS
 * admits every account the caller is a member of
 * (`account_id in (select pilot.current_account_ids())`) while
 * getSessionContext resolves ONE of them, so the two are not the same set
 * for a user who belongs to two accounts. A read that feeds a write has
 * to be scoped the same way the write is; RLS is the floor, not the
 * selector. (A plain listing select — clients/page.tsx, settings/page.tsx
 * — is a different case and keeps the house convention.)
 */
async function loadDomainRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  domain: CustomOptionDomain
): Promise<{ rows: CustomOptionRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("custom_options")
    .select("id, domain, key, label, sort_order, is_builtin, archived_at")
    .eq("account_id", accountId)
    .eq("domain", domain)
    .limit(500);

  if (error) {
    return { rows: [], error: friendlyDbError(error, "custom_options.reorder-read") };
  }
  return {
    rows: rowsForDomain((data ?? []) as CustomOptionRow[], domain),
    error: null,
  };
}

/**
 * Rename. The LABEL is the only thing a pilot may change about an option,
 * built-in or not — `key` is absent from the UPDATE grant AND refused by
 * custom_options_protect, because moving a key would orphan every
 * historical expense, trip and document filed under it.
 */
export async function renameCustomOption(
  _prev: CustomizationFormState,
  formData: FormData
): Promise<CustomizationFormState> {
  const id = String(formData.get("id") ?? "");
  const domainRaw = String(formData.get("domain") ?? "");
  if (!id || !isCustomOptionDomain(domainRaw)) {
    return { error: "Missing option." };
  }
  const domain: CustomOptionDomain = domainRaw;

  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can change these lists." };
  }

  const label = String(formData.get("label") ?? "").trim();
  const echo = { label };
  if (!label) return { error: "Give it a name.", values: echo };
  if (label.length > MAX_OPTION_LABEL) {
    return { error: `Keep the name under ${MAX_OPTION_LABEL} characters.`, values: echo };
  }

  const supabase = await createClient();
  const payload: CustomOptionUpdate = { label };
  const { error, count } = await supabase
    .from("custom_options")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) {
    return { error: friendlyDbError(error, "custom_options.rename"), values: echo };
  }
  if (count === 0) return { error: "Couldn't rename that.", values: echo };

  revalidateDomain(domain);
  return { error: null, saved: true };
}

/**
 * Archive / restore.
 *
 * A BUILT-IN CANNOT BE ARCHIVED, and that is enforced in three places on
 * purpose. The row's own control is not rendered for a built-in
 * (category-row.tsx); this action refuses before touching the database;
 * and pilot.custom_options_protect refuses in the database whatever the
 * app does. The trigger raises a plain exception, which arrives as
 * SQLSTATE P0001 — friendlyDbError has no sentence for that code and
 * would fall through to "Couldn't save that. Try again.", which tells a
 * pilot nothing about a rule they just hit. So P0001 is caught here and
 * answered with the trigger's own reasoning, the same way
 * day-types-actions.ts catches 23514 for the built-in delete ban.
 */
export async function setCustomOptionArchived(
  id: string,
  domain: string,
  archived: boolean
): Promise<{ error: string | null }> {
  if (!isCustomOptionDomain(domain)) return { error: "Missing option." };

  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can change these lists." };
  }

  const supabase = await createClient();

  if (archived) {
    const { data: rowData } = await supabase
      .from("custom_options")
      .select("is_builtin, key")
      .eq("id", id)
      .eq("account_id", account.id)
      .maybeSingle();
    const row = rowData as { is_builtin: boolean; key: string } | null;
    if (row?.is_builtin) {
      return {
        error:
          "This is one of the built-in options and can't be retired. It's what your " +
          "existing records are already filed under. Rename it instead; the new name " +
          "shows everywhere, including on past records.",
      };
    }
  }

  const payload: CustomOptionUpdate = {
    archived_at: archived ? new Date().toISOString() : null,
  };
  const { error, count } = await supabase
    .from("custom_options")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  // Returned rather than thrown: this runs inside a useTransition on the
  // client, where a throw is swallowed and the button just appears to do
  // nothing.
  if (error) {
    if (error.code === "P0001") {
      return {
        error:
          "This is one of the built-in options and can't be retired. It's what your " +
          "existing records are already filed under. Rename it instead.",
      };
    }
    return { error: friendlyDbError(error, "custom_options.archive") };
  }
  if (count === 0) return { error: "Couldn't update that option." };

  revalidateDomain(domain);
  return { error: null };
}

/**
 * Reorder by one place.
 *
 * Renumbers the domain to `index * 10` in the new order and writes only
 * the rows whose number actually changed — normally exactly two. Doing it
 * this way rather than swapping two values means the list SELF-HEALS: an
 * account whose sort_orders were ever duplicated (a restored backup, a
 * hand-written INSERT) is renumbered into a strict order the first time
 * anyone moves anything, instead of quietly staying ambiguous.
 *
 * The list it reorders is the same list the panel renders — archived rows
 * included, in the same order — so "up" moves a row past whatever is
 * visually above it.
 */
export async function moveCustomOption(
  id: string,
  domain: string,
  direction: "up" | "down"
): Promise<{ error: string | null }> {
  if (!isCustomOptionDomain(domain)) return { error: "Missing option." };

  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can change these lists." };
  }

  const supabase = await createClient();

  const { rows: ordered, error: readError } = await loadDomainRows(
    supabase,
    account.id,
    domain
  );
  if (readError) return { error: readError };

  const index = ordered.findIndex((row) => row.id === id);
  if (index === -1) return { error: "Couldn't find that option." };

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return { error: null };

  const moved = ordered[index];
  const displaced = ordered[target];
  if (!moved || !displaced) return { error: "Couldn't reorder that option." };

  const next = ordered.slice();
  next[index] = displaced;
  next[target] = moved;

  for (const [position, row] of next.entries()) {
    const sortOrder = (position + 1) * 10;
    if (row.sort_order === sortOrder) continue;

    const payload: CustomOptionUpdate = { sort_order: sortOrder };
    const { error, count } = await supabase
      .from("custom_options")
      .update(payload as never, { count: "exact" })
      .eq("id", row.id)
      .eq("account_id", account.id);

    if (error) return { error: friendlyDbError(error, "custom_options.reorder") };
    if (count === 0) return { error: "Couldn't reorder that option." };
  }

  revalidateDomain(domain);
  return { error: null };
}

/*
 * THERE IS DELIBERATELY NO createCustomOption ACTION IN THIS FILE.
 *
 * See lib/custom-options.ts's header for the full reasoning and
 * 20260813000000's for the decision behind it: all three columns these
 * options feed still carry a CHECK pinning them to the built-in keys, so
 * a brand-new key cannot be STORED on an expense, trip or document today.
 * An "add a category" control would therefore mint a row that no record
 * could ever use — a picker offering a value the database refuses, which
 * is worse than a picker that does not offer it.
 *
 * The categories panel says so in plain words instead of hiding it, and
 * DOMAIN_KEYS_ARE_PINNED (lib/custom-options.ts) is the single switch to
 * flip in the same change that widens those CHECKs.
 */
