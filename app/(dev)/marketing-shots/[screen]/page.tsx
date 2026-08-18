import { notFound } from "next/navigation";
import { themeForSlots, DEFAULT_THEME_SLOTS } from "@/lib/theme-slots";
import { AppShell } from "../../../(app)/app-shell";
import { FIXTURE_ACCOUNT, FIXTURE_EMAIL, shotSections } from "../fixtures";
import InvoiceScreen from "../invoice-screen";
import LogbookScreen from "../logbook-screen";
import OverviewScreen from "../overview-screen";

/**
 * THE MARKETING SCREENSHOT HARNESS — development only, 404 everywhere else.
 *
 * Same precedent, same guard and same reason as ../../layout-harness: the
 * product's screens live behind requireAccount(), so they cannot be
 * rendered — or photographed — without a session, a tenant and a database.
 * This route renders the REAL <AppShell> (the component app/(app)/layout.tsx
 * renders) around one product screen built from fixtures, so
 * scripts/marketing-shots.mjs can drive a real Chromium at it and write
 * PNGs the landing page then uses instead of a hand-drawn approximation.
 *
 * ── THE TWO HONEST WAYS TO GET A SCREEN IN HERE ──────────────────────
 *
 * 1. EXTRACT the presentation into props-driven components the real page
 *    then also renders. Preferred, because the screenshot cannot then
 *    drift from the screen. Used for INVOICES (../invoice-screen.tsx —
 *    that screen was already assembled this way, and only its totals block
 *    had to move) and for the LOGBOOK (../logbook-screen.tsx, via the new
 *    app/(app)/logbook/panels.tsx, which app/(app)/logbook/page.tsx
 *    renders too).
 *
 * 2. RE-COMPOSE the same Ledger primitives, and SAY SO. Used for OVERVIEW
 *    (../overview-screen.tsx) and only there: that screen is a ~1,960-line
 *    server component with its presentation welded to twenty-odd Supabase
 *    reads and their error gates, and extracting it would be a large,
 *    risky refactor of the busiest file in the product for the sake of a
 *    picture. That file's own header states plainly that it is a
 *    composition rather than the real screen, and names what that costs.
 *
 * Never present the second as the first.
 *
 * ── WHAT MUST NEVER APPEAR HERE ──────────────────────────────────────
 *
 * The counsel-gated currency board, on any surface a screenshot can reach.
 * The rail below is built from visibleNavSections(false) — the flag-OFF
 * view — by ../fixtures.ts's shotSections(), exactly as the marketing
 * surface has always done, and no screen in this harness renders currency.
 *
 * And no real customer data, ever. Every figure, name, registration and
 * dollar amount comes from ../fixtures.ts and is invented; see that file's
 * header for the standard, including the aviation facts (61.23 month-end
 * medical expiry, per-leg logbook entries, PIC and SIC kept apart) that
 * make a synthetic figure read as plausible rather than as wrong.
 */

const SCREENS = {
  overview: OverviewScreen,
  invoices: InvoiceScreen,
  logbook: LogbookScreen,
} as const;

type ScreenKey = keyof typeof SCREENS;

function isScreenKey(value: string): value is ScreenKey {
  return Object.prototype.hasOwnProperty.call(SCREENS, value);
}

export default async function MarketingShotPage({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  // Belt and braces, exactly as the layout harness does it: the route group
  // is not excluded from the production build, so the guard — not the
  // absence of a link to it — is what keeps this off the live site.
  if (process.env.NODE_ENV !== "development") notFound();

  const { screen } = await params;
  if (!isScreenKey(screen)) notFound();
  const Screen = SCREENS[screen];

  const theme = themeForSlots(DEFAULT_THEME_SLOTS);

  return (
    <AppShell
      userEmail={FIXTURE_EMAIL}
      accountName={FIXTURE_ACCOUNT}
      sections={shotSections()}
      theme={theme}
      readOnlyNotice={null}
      // The real shell takes a server action here. The harness never
      // submits it; it exists so the button renders at its true size.
      signOutAction={async () => {
        "use server";
      }}
    >
      <Screen />
    </AppShell>
  );
}
