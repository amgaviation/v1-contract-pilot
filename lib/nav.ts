/**
 * The product's navigation — single source for the rail, the phone strip,
 * and robots.txt's disallow list.
 *
 * Replaces the ported kit's lib/mdpro/routes.js, which carried the kit's
 * own icon-name strings, collapse groups and demo entries. This stayed a
 * flat list in docs/PLAN.md's order until the 2026-08 design rebuild
 * (docs/design/REBUILD-BRIEF.md §4.2), whose grouped rail supersedes the
 * old flat order: sections are now grouped OPS / BUSINESS / RECORDS, and
 * the list below is written in group order so the rail can render group
 * headers with a plain "did the group change" check, no re-sorting.
 *
 * Settings still sits apart from the feature sections deliberately — it is
 * where a pilot changes how the rest behaves, not another place to file
 * work, and the rail renders it below a separator for that reason.
 */
export type NavGroup = "OPS" | "BUSINESS" | "RECORDS";

export type NavItem = {
  href: string;
  label: string;
  /** Rail group header. Settings sits apart and carries none. */
  group?: NavGroup;
};

/**
 * WHERE THE DASHBOARD LIVES, and the only place that fact is written down.
 *
 * This constant exists because moving it once already left seven stale
 * references behind. Overview used to serve at "/"; when the public landing
 * page took that path (app/(marketing)/page.tsx), every call site that had
 * spelled the dashboard as "/" kept compiling and kept passing review, because
 * a route is a string and a string cannot be wrong at build time.
 *
 * Six of the seven were invisible: app/(marketing)/page.tsx redirects a
 * provisioned session to the dashboard, so a login that sent a pilot to "/"
 * still ARRIVED at Overview, one wasted round trip later — correct by
 * accident, and only for as long as the marketing page keeps bouncing. The
 * seventh had no such safety net: markTripCompleted's revalidatePath("/")
 * simply stopped naming the screen it existed to refresh and started poking a
 * marketing page instead.
 *
 * So the fix is not seven corrected literals — that is the same bug waiting
 * for the next move. It is that there is now exactly one string, and
 * tests/dashboard-path.test.mjs fails the build if any file spells the
 * dashboard by hand: either the retired "/" or whatever value this constant
 * currently holds. The first version of that test only knew about "/", which
 * made it a record of one migration rather than a guard — a reviewer caught
 * that, and four hand-written "/overview" literals with it.
 *
 * WHAT MOVING THIS ACTUALLY COSTS, stated precisely so the claim is not
 * overstated: changing this line updates every REFERENCE — links, redirects,
 * revalidation, the post-login return path, and robots.txt's disallow list,
 * all of which derive from it. It does NOT move the page. The route still
 * comes from the directory name, so a real move is this line plus renaming
 * app/(app)/overview/. Verified by doing it: with this constant repointed,
 * test:unit, typecheck and build all stay green and no reference is left
 * behind — which is the part that used to break.
 */
export const DASHBOARD_PATH = "/overview";

/**
 * Currency's path, named once for the same reason DASHBOARD_PATH is: the
 * flag-visibility filter below and app/(app)/currency/'s directory name
 * both mean this screen, and a second spelling is a second thing to move.
 */
export const CURRENCY_PATH = "/currency";

/**
 * EVERY signed-in section, INCLUDING flag-gated ones. robots.txt
 * (app/robots.ts) derives its disallow list from this array, and a
 * flag-gated screen is exactly as private as a live one — /currency must
 * be disallowed whether or not the engine is enabled. What the flag
 * governs is what the RAIL shows, and that is visibleNavSections() below,
 * not membership in this list.
 */
export const NAV_SECTIONS: readonly NavItem[] = [
  { href: DASHBOARD_PATH, label: "Overview", group: "OPS" },
  { href: "/trips", label: "Trips", group: "OPS" },
  { href: "/logbook", label: "Logbook", group: "OPS" },
  { href: "/estimates", label: "Estimates", group: "BUSINESS" },
  { href: "/invoices", label: "Invoices", group: "BUSINESS" },
  { href: "/expenses", label: "Expenses", group: "BUSINESS" },
  { href: "/clients", label: "Clients", group: "BUSINESS" },
  { href: "/accounting", label: "Accounting", group: "BUSINESS" },
  { href: "/documents", label: "Documents", group: "RECORDS" },
  { href: "/receipts", label: "Receipts", group: "RECORDS" },
  { href: "/aircraft", label: "Aircraft", group: "RECORDS" },
  { href: "/crew", label: "Crew", group: "RECORDS" },
  { href: "/reports", label: "Reports", group: "RECORDS" },
  { href: CURRENCY_PATH, label: "Currency", group: "RECORDS" },
] as const;

export const NAV_SETTINGS: NavItem = { href: "/settings", label: "Settings" };

/**
 * The user guide (app/(app)/help).
 *
 * Sits apart from NAV_SECTIONS for the same reason Settings does: it is not
 * another place to file work, so it must not appear in the tenant's
 * reorder-and-hide layout (that feature enumerates NAV_SECTIONS, and a
 * pilot hiding Help would be hiding the thing they reach for when they are
 * already lost). Rendered next to Settings, below the separator.
 *
 * Still listed in robots.txt's disallow set via app/robots.ts, like every
 * other signed-in path — the guide describes a specific account's product
 * and is behind the session.
 */
export const NAV_HELP: NavItem = { href: "/help", label: "Help" };

/**
 * THE COMMAND PALETTE'S "FEATURES" LAYER — actions and sub-pages, the half
 * of "search any feature" that is not a top-level section.
 *
 * These are deep links the rail never shows (a rail of every create-action
 * and every report would be unusable), surfaced only when a pilot types in
 * ⌘K. Two groups:
 *   Create  — the new-record and import actions ("New invoice", "Import
 *             expenses").
 *   Go to   — sub-pages under a section ("Profit & loss", "Billing & plan").
 *
 * NOT A GATE, exactly like NAV_SECTIONS above: listing a command here does
 * not open its route. Every href still lands on a page that runs its own
 * requireAccount / requireEntitlement / flag check, so a command for a
 * page a tenant cannot use redirects there rather than rendering it — which
 * is why entitlement- and flag-specific deep links (recurring invoices,
 * anything currency) are deliberately LEFT OUT rather than shown and
 * bounced. `keywords` are extra terms cmdk matches beyond the label, so
 * "add" or "create" finds "New …", "p&l" finds "Profit & loss".
 *
 * robots.txt is unaffected: app/robots.ts derives its disallow list from
 * NAV_SECTIONS, and every href below is a sub-path of a section already in
 * that list.
 */
export type NavCommandGroup = "Create" | "Go to";

export type NavCommand = {
  href: string;
  label: string;
  group: NavCommandGroup;
  keywords?: readonly string[];
};

export const NAV_COMMANDS: readonly NavCommand[] = [
  // Create — the new-record and import actions.
  { href: "/trips/new", label: "New trip", group: "Create", keywords: ["add", "create", "leg", "flight"] },
  { href: "/invoices/new", label: "New invoice", group: "Create", keywords: ["add", "create", "bill"] },
  { href: "/estimates/new", label: "New estimate", group: "Create", keywords: ["add", "create", "quote", "proposal"] },
  { href: "/expenses/new", label: "New expense", group: "Create", keywords: ["add", "create", "receipt"] },
  { href: "/clients/new", label: "New client", group: "Create", keywords: ["add", "create", "operator", "customer"] },
  { href: "/documents/new", label: "New document", group: "Create", keywords: ["add", "create", "upload", "w-9", "insurance", "medical"] },
  { href: "/crew/new", label: "New crew member", group: "Create", keywords: ["add", "create", "pilot", "sic", "copilot"] },
  { href: "/logbook/new", label: "New logbook entry", group: "Create", keywords: ["add", "create", "flight", "hours"] },
  // The landing FAQ's lead objection-handler ("import a ForeFlight or
  // LogTen export") was reachable only via /logbook's header button —
  // typing "import" or "logbook" into ⌘K surfaced bank imports but not
  // this. The palette is the product's only search; the promise belongs
  // in it.
  { href: "/logbook/import", label: "Import logbook", group: "Create", keywords: ["foreflight", "logten", "csv", "flights", "hours"] },
  { href: "/expenses/import", label: "Import expenses", group: "Create", keywords: ["bank", "csv", "statement", "transactions"] },
  { href: "/expenses/mileage", label: "Log mileage", group: "Create", keywords: ["drive", "miles", "deduction", "car"] },
  // Go to — sub-pages under a section.
  { href: "/reports/profit-loss", label: "Profit & loss", group: "Go to", keywords: ["p&l", "pnl", "income", "report"] },
  { href: "/reports/balance-sheet", label: "Balance sheet", group: "Go to", keywords: ["report"] },
  { href: "/reports/cash-flow", label: "Cash flow", group: "Go to", keywords: ["report"] },
  { href: "/reports/sales-tax", label: "Sales tax", group: "Go to", keywords: ["report", "tax"] },
  { href: "/reports/quarterly", label: "Quarterly summary", group: "Go to", keywords: ["report", "estimated", "tax"] },
  { href: "/reports/year-end", label: "Year-end summary", group: "Go to", keywords: ["report", "1099", "tax", "annual"] },
  { href: "/reports/trip-pl", label: "Trip profit & loss", group: "Go to", keywords: ["report", "pnl"] },
  { href: "/reports/flight-time", label: "Flight time", group: "Go to", keywords: ["report", "hours"] },
  { href: "/reports/pilot-history", label: "Pilot history", group: "Go to", keywords: ["report", "resume", "experience"] },
  // Aircraft used to be a "Go to" sub-page command (/logbook/aircraft).
  // Promoted to its own NAV_SECTIONS entry above — a top-level section
  // needs no Go-to command, and keeping one here would collide with the
  // section's own label (tests/nav-commands.test.mjs forbids that).
  { href: "/logbook/drafts", label: "Logbook drafts", group: "Go to", keywords: ["pending", "confirm"] },
  { href: "/expenses/transactions", label: "Bank transactions", group: "Go to", keywords: ["import", "reconcile"] },
  { href: "/settings/billing", label: "Billing & plan", group: "Go to", keywords: ["subscription", "upgrade", "stripe", "payment"] },
  { href: "/settings/export", label: "Export data", group: "Go to", keywords: ["download", "backup", "csv"] },
] as const;

/**
 * The sections the rail and phone strip actually render.
 *
 * Currency ships behind THE flag (docs/PLAN.md decision #15;
 * lib/currency/gate.ts) and navigation is one of its four independent
 * enforcement points: with the engine off, the entry is not merely
 * unlinked-but-present, it is absent from the rendered nav entirely.
 *
 * The flag itself cannot be read here — lib/currency/gate.ts is
 * `server-only` and the rail is a client component (it needs the current
 * path) — so the SERVER layout (app/(app)/layout.tsx) calls
 * isCurrencyEngineEnabled() and passes this function's result down as
 * props. Keeping the filter in this file, next to the list it filters,
 * is what keeps the nav single-source: the rail never composes its own
 * section list.
 */
export function visibleNavSections(currencyEnabled: boolean): readonly NavItem[] {
  return currencyEnabled
    ? NAV_SECTIONS
    : NAV_SECTIONS.filter((item) => item.href !== CURRENCY_PATH);
}

/**
 * ===========================================================================
 * THE TENANT'S NAV LAYOUT — Phase 9 Layer 2, the layout half.
 *
 * A pilot who never files an estimate and never touches Accounting should
 * be able to put those two out of the way, and put Trips at the top. That
 * is the whole feature. What it is emphatically NOT is a permission
 * system, and the distinction is the most important thing in this block:
 *
 *   HIDING A SECTION HIDES THE NAV ENTRY. IT DOES NOT CLOSE THE ROUTE.
 *
 * /estimates still resolves, still renders, still writes; a bookmark, a
 * deep link from an invoice, and a link inside another screen all keep
 * working. Nothing below is consulted by any gate — the route-level gates
 * are requireAccount (lib/supabase/account.ts), requireEntitlement
 * (lib/supabase/entitlements.ts) and the currency flag, none of which
 * reads a preference. robots.txt likewise derives its disallow list from
 * NAV_SECTIONS above, not from the layout, so a hidden section is still
 * disallowed to crawlers. tests/nav-layout.test.mjs asserts all of that,
 * because a "hidden" that quietly became "forbidden" would be a security
 * story invented by a display preference.
 *
 * Currency's flag stays upstream and unaffected: the layout applies to
 * whatever visibleNavSections(flag) already returned, so a tenant layout
 * can neither resurrect a flag-gated section nor be lost when the flag is
 * later switched on (the stored order still names /currency and comes back
 * into force with it).
 * ===========================================================================
 */
export type NavLayout = {
  /**
   * Section hrefs, most-wanted first. Anything not named keeps its place
   * relative to the other unnamed sections and follows them — so adding a
   * new section to NAV_SECTIONS never needs a stored layout to be
   * rewritten, and never makes one wrong.
   */
  order: readonly string[];
  /** Section hrefs to leave out of the rail and the phone strip. */
  hidden: readonly string[];
};

export const DEFAULT_NAV_LAYOUT: NavLayout = { order: [], hidden: [] };

/**
 * A generous bound on a stored list. NAV_SECTIONS has eleven entries; a
 * stored array longer than this is not a layout, it is either corruption
 * or someone probing the 16 KB prefs ceiling, and truncating it costs a
 * pilot nothing.
 */
const MAX_NAV_LAYOUT_ENTRIES = 64;

function knownSectionHrefs(): ReadonlySet<string> {
  return new Set(NAV_SECTIONS.map((item) => item.href));
}

/**
 * Untrusted jsonb → a layout every function here can trust.
 *
 * Total, like every other resolver in this product's preference path: a
 * string, a number, null, an array of arrays, or an object whose `order`
 * is a boolean all resolve to DEFAULT_NAV_LAYOUT rather than throwing.
 * Three things are dropped rather than honoured:
 *
 *   - hrefs that are not sections (a stale entry from a section that was
 *     renamed or removed, or an invented one). A stale href in a stored
 *     layout is the expected steady state after any nav change, not an
 *     error, so it is ignored silently.
 *   - duplicates, which would otherwise let one section claim two ranks.
 *   - /settings, in EITHER list. Settings is not one of NAV_SECTIONS at
 *     all — the rail renders it separately, below its own separator,
 *     precisely because it is where a pilot changes how the rest behaves
 *     rather than another place to file work. So it is not a section to
 *     order, and it is not a section to hide: no stored blob, however it
 *     got there, can take away the way back to this screen. That falls
 *     out of the known-sections filter rather than needing a special
 *     case, which is why there isn't one.
 */
export function normalizeNavLayout(raw: unknown): NavLayout {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return DEFAULT_NAV_LAYOUT;
  }

  const known = knownSectionHrefs();
  const source = raw as Record<string, unknown>;

  const clean = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
      if (out.length >= MAX_NAV_LAYOUT_ENTRIES) break;
      if (typeof entry !== "string") continue;
      if (!known.has(entry)) continue;
      if (seen.has(entry)) continue;
      seen.add(entry);
      out.push(entry);
    }
    return out;
  };

  return {
    order: clean(source.order),
    hidden: clean(source.hidden),
  };
}

/**
 * The pure function the shell calls: a tenant's order and hidden set,
 * applied on top of whatever visibleNavSections(currencyEnabled) returned.
 *
 * ORDER IS STABLE. Sections named in `order` come first, in that order;
 * everything else follows in its NAV_SECTIONS order, unshuffled. That is a
 * rank-and-stable-sort, not a rebuild of the list, which is what makes the
 * two properties this needs both true at once: a layout stored before a
 * new section existed still applies cleanly, and the new section lands in
 * a sensible place instead of a random one.
 *
 * The group headers the rail draws (OPS / BUSINESS / RECORDS) are computed
 * by walking the returned list and rendering a header wherever the group
 * changes. A reordered list can therefore break their meaning, and the
 * rail must not simply print what falls out — see navGroupsAreContiguous
 * below, which is the predicate it gates on.
 */
export function applyNavLayout(
  sections: readonly NavItem[],
  layout: NavLayout
): readonly NavItem[] {
  const hidden = new Set(layout.hidden);
  // Belt and braces over normalizeNavLayout: a caller that hand-built a
  // NavLayout (a test, a future import path) still cannot hide Settings.
  hidden.delete(NAV_SETTINGS.href);

  const rank = new Map<string, number>();
  layout.order.forEach((href, index) => {
    if (!rank.has(href)) rank.set(href, index);
  });

  return sections
    .filter((item) => !hidden.has(item.href))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rankA = rank.get(a.item.href) ?? Number.POSITIVE_INFINITY;
      const rankB = rank.get(b.item.href) ?? Number.POSITIVE_INFINITY;
      // The explicit index tiebreak is what makes this a STABLE sort
      // regardless of the engine's own sort stability guarantees.
      return rankA === rankB ? a.index - b.index : rankA - rankB;
    })
    .map(({ item }) => item);
}

/**
 * Whether every group in this list is still ONE CONTIGUOUS RUN — i.e.
 * whether group headers still mean anything for it.
 *
 * The rail draws a header wherever the group changes walking the list.
 * That is correct for the default order, in which each group is a single
 * run, and it silently stops being correct the moment a tenant interleaves
 * two groups: a pilot who moves Invoices to the top gets "BUSINESS /
 * Invoices / OPS / Overview / Trips / Logbook / BUSINESS / Estimates …",
 * with BUSINESS printed twice and a four-step gap injected mid-list. Two
 * more moves and nearly every item carries a header, at which point the
 * headers convey no grouping at all — a striped rail that is strictly
 * worse than an ungrouped one.
 *
 * So the rail asks this first and falls back to a FLAT list when the
 * answer is no. Not "the tenant set an order", deliberately: hiding
 * sections, or reordering WITHIN a group, or promoting a whole group,
 * all keep the runs intact and keep their headers. Only an arrangement
 * that has actually broken the grouping loses them, which is both the
 * honest rendering and the one the pilot's own arrangement asked for.
 */
export function navGroupsAreContiguous(sections: readonly NavItem[]): boolean {
  const seen = new Set<string>();
  let previous: string | undefined;

  for (const item of sections) {
    const group = item.group;
    if (group === previous) continue;
    if (group !== undefined) {
      // A group we have already closed out and are now re-entering: its
      // items are no longer one run.
      if (seen.has(group)) return false;
      seen.add(group);
    }
    previous = group;
  }

  return true;
}

/**
 * Whether a nav item should render as the current section.
 *
 * Overview moved from "/" to "/overview" when the public landing page took
 * over the root path (see app/(marketing)/page.tsx), which retired the
 * exact-match special case this function used to need: every href here is
 * now a genuine path segment, and none of them is a prefix of another, so
 * plain prefix matching is correct for all sections including Overview.
 */
export function isCurrentSection(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
