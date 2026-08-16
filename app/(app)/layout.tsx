import { applyNavLayout, visibleNavSections } from "@/lib/nav";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";
import { loadPreferences, themeFor } from "@/lib/preferences";
import { accountIsReadOnly, requireAccount } from "@/lib/supabase/account";
import { accountLogoUrl } from "@/lib/account-logo";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "./app-shell";
import { signOut } from "./actions";

/**
 * The authenticated surface. Every feature page lives under this group,
 * so this one server-side gate covers all of them: requireAccount()
 * redirects a signed-out visitor to /login and a signed-in-but-
 * unprovisioned one to /welcome before any chrome or tenant data is
 * rendered. Route groups don't change URLs, so pages here still serve at
 * "/overview", "/invoices", etc. (Overview served at "/" until the public
 * landing page took that path — see lib/nav.ts's DASHBOARD_PATH.)
 *
 * This file is now the SESSION READ and nothing else: the chrome itself —
 * the dark rail, the phone strip, the sticky header, the canvas and its
 * measure — lives in ./app-shell.tsx, which takes props and touches no
 * database. That split exists so the shell can be rendered without a
 * session and measured across a width matrix (scripts/layout-verify.mjs
 * against app/(dev)/layout-harness). While the markup was inline here it
 * was behind requireAccount(), so the responsive behaviour of every page
 * in the product was the one part of it that could not be tested.
 *
 * Being a server component is what lets this file read the server-only
 * currency flag (lib/currency/gate.ts) and hand the shell its section
 * list with Currency already filtered out when the engine is off —
 * navigation is one of that flag's four independent enforcement points.
 *
 * THE TENANT THEME (Phase 9 Layer 2): three enumerated slots — accent,
 * density (scaling) and light/dark — are resolved from
 * pilot.account_preferences by lib/preferences.ts and passed to the
 * shell, which wraps itself in a nested <Theme>. THE NAV LAYOUT rides
 * the same preferences read: applyNavLayout applies the tenant's order
 * and hidden set on top of the currency-filtered list. Hiding hides the
 * RAIL ENTRY only — every route still resolves, and nothing here or
 * below it gates on the layout.
 */

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The layout is a READ (a GET render), so requireAccount never refuses
  // it — a read-only account still gets its full shell. The banner the
  // shell renders is the account-status notice (Finding 3): shown on
  // every page so a lapsed pilot always sees why their writes are being
  // bounced to Billing.
  const { user, account } = await requireAccount();
  const readOnly = accountIsReadOnly(account);

  // One preferences read per authenticated render, feeding both the theme
  // and the nav. loadPreferences is total and never throws: a missing row
  // (the ordinary state until a pilot changes something), an unreadable
  // one, and a blob full of values this build no longer recognises all
  // resolve to the app's own defaults.
  const preferences = await loadPreferences(account.id);
  const theme = themeFor(preferences);
  const sections = applyNavLayout(
    visibleNavSections(isCurrencyEngineEnabled()),
    preferences.nav
  );

  // The tenant's own uploaded logo, if any (Settings → logo-panel.tsx),
  // shown in place of the V1 mark. Null (no upload, or a mint failure)
  // falls back to the default mark inside AppShell.
  const supabase = await createClient();
  const logoUrl = await accountLogoUrl(supabase, account.id);

  return (
    <AppShell
      userEmail={user.email ?? ""}
      accountName={account.legal_name}
      sections={sections}
      theme={theme}
      readOnly={readOnly}
      signOutAction={signOut}
      logoUrl={logoUrl}
    >
      {children}
    </AppShell>
  );
}
