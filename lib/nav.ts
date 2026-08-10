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

export const NAV_SECTIONS: readonly NavItem[] = [
  { href: "/overview", label: "Overview" },
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
