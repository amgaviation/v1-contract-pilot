/**
 * The product's navigation, in the order docs/PLAN.md fixes it.
 *
 * Replaces the ported kit's lib/mdpro/routes.js, which carried the kit's
 * own icon-name strings, collapse groups and demo entries. This is a plain
 * list because that is all the nav has ever needed.
 *
 * Settings sits apart from the eight feature sections deliberately — it is
 * where a pilot changes how the rest behaves, not another place to file
 * work, and the rail renders it below a separator for that reason.
 */
export type NavItem = {
  href: string;
  label: string;
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
 * tests/dashboard-path.test.mjs fails the build if a new "/" -as-dashboard
 * literal appears anywhere in the app.
 */
export const DASHBOARD_PATH = "/overview";

export const NAV_SECTIONS: readonly NavItem[] = [
  { href: DASHBOARD_PATH, label: "Overview" },
  { href: "/trips", label: "Trips" },
  { href: "/invoices", label: "Invoices" },
  { href: "/expenses", label: "Expenses" },
  { href: "/logbook", label: "Logbook" },
  { href: "/clients", label: "Clients" },
  { href: "/documents", label: "Documents" },
  { href: "/reports", label: "Reports" },
] as const;

export const NAV_SETTINGS: NavItem = { href: "/settings", label: "Settings" };

/**
 * Whether a nav item should render as the current section.
 *
 * Overview moved from "/" to "/overview" when the public landing page took
 * over the root path (see app/(marketing)/page.tsx), which retired the
 * exact-match special case this function used to need: every href here is
 * now a genuine path segment, and none of them is a prefix of another, so
 * plain prefix matching is correct for all eight sections including
 * Overview.
 */
export function isCurrentSection(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
