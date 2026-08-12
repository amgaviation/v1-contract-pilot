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
  { href: "/reports", label: "Reports", group: "RECORDS" },
  { href: CURRENCY_PATH, label: "Currency", group: "RECORDS" },
] as const;

export const NAV_SETTINGS: NavItem = { href: "/settings", label: "Settings" };

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
