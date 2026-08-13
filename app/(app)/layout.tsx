import Link from "next/link";
import {
  Box,
  Button,
  Callout,
  Container,
  Flex,
  Separator,
  Text,
  Theme,
} from "@/components/ui";
import { Logo } from "@/components/ui/logo";
import { BRAND } from "@/lib/brand";
import { applyNavLayout, DASHBOARD_PATH, visibleNavSections } from "@/lib/nav";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";
import { loadPreferences, themeFor } from "@/lib/preferences";
import { accountIsReadOnly, requireAccount } from "@/lib/supabase/account";
import { NavRail, NavStrip } from "./nav-rail";
import SkipLink from "./skip-link";
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
 * The shell is a server component and the rail is the only client piece
 * (it needs the current path). The kit this replaced inverted that — a
 * client shell wrapping everything — which forced client boundaries much
 * further down the tree than any of these screens actually need. Being a
 * server component is also what lets this file read the server-only
 * currency flag (lib/currency/gate.ts) and hand the rail its section
 * list with Currency already filtered out when the engine is off —
 * navigation is one of that flag's four independent enforcement points.
 *
 * THE DARK RAIL (2026-08 rebuild, docs/design/REBUILD-BRIEF.md §2, §4):
 * the rail and the phone top bar are the product's one dark surface — a
 * nested <Theme appearance="dark">. Verified against the installed
 * @radix-ui/themes 3.3.0 source: an explicit appearance="dark" on a
 * nested Theme stamps `class="radix-themes dark"` AND auto-enables
 * hasBackground, so the element paints its own dark ground
 * (--color-background) with no extra CSS; it inherits the root's
 * accent/gray context, so the rail is the same indigo/slate system at
 * night. It renders server-side — no script, no flash, no hydration
 * concern. globals.css's `.radix-themes.dark` selector (previously
 * dormant, documented there) flips the wordmark to white on this ground
 * automatically; the bug stays #036BFC per the logo kit. The hairline
 * borders sit INSIDE the dark theme so --gray-a5 resolves against the
 * dark scale.
 *
 * THE TENANT THEME (Phase 9 Layer 2). One nested <Theme> now wraps this
 * whole shell, carrying three enumerated slots — accent, density
 * (scaling) and light/dark — resolved from pilot.account_preferences by
 * lib/preferences.ts. It sits INSIDE app/layout.tsx's root Theme and
 * OUTSIDE the two dark islands, which is what makes the composition work
 * in both directions:
 *
 *     root <Theme accentColor="indigo" appearance="light" …>   app/layout.tsx
 *       └ <Theme {tenant accent / scaling / appearance}>       here
 *           |- <Theme appearance="dark">   phone strip
 *           |- <Theme appearance="dark">   rail
 *           `- header / canvas / main
 *
 * The rail's own appearance="dark" is the NEAREST ancestor for the rail,
 * so it stays dark whatever the tenant chose, and it inherits the
 * tenant's accent — the same inheritance the indigo rail already relied
 * on. Nothing outside this route group is affected: marketing and auth
 * render under the root Theme alone and never read a preference.
 *
 * The two grounds come from the resolved theme rather than being written
 * here, because they SWAP between modes — see themeForSlots() in
 * lib/theme-slots.ts for the full reasoning. In light they resolve to the
 * exact tokens this file used before (white chrome, --gray-2 canvas); in
 * dark they trade places, so the rail LIFTS off the canvas instead of
 * merging with it and Cards keep reading as panels.
 *
 * THE NAV LAYOUT rides the same preferences read: applyNavLayout applies
 * the tenant's order and hidden set on top of the currency-filtered list.
 * Hiding hides the RAIL ENTRY only — every route still resolves, and
 * nothing in this file or below it gates on the layout.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The layout is a READ (a GET render), so requireAccount never refuses
  // it — a read-only account still gets its full shell. The banner below is
  // the account-status notice (Finding 3): rendered on every page so a
  // lapsed pilot always sees why their writes are being bounced to Billing.
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

  return (
    <Theme
      accentColor={theme.accentColor}
      scaling={theme.scaling}
      appearance={theme.appearance}
      asChild
    >
    <Flex direction={{ initial: "column", sm: "row" }} minHeight="100vh">
      <SkipLink />

      {/* H9: the phone-width top bar — logo plus a horizontally
          scrolling section strip, replacing the ~400-450px column of
          logo/links/separator/Settings/account block the full vertical
          rail used to plant in front of every page below `sm`. Always
          rendered (never conditionally mounted): only `display` toggles
          across the breakpoint, so switching pages never adds or removes
          these nodes and never shifts layout. The dark theme paints its
          own ground; the border lives inside it (dark-scale hairline). */}
      <Box display={{ initial: "block", sm: "none" }}>
        <Theme appearance="dark" asChild>
          <Box
            style={{
              borderBottom: "1px solid var(--gray-a5)",
              background: theme.chromeBackground,
            }}
          >
            <Flex align="center" gap="2" px="3" pt="3">
              <Link href={DASHBOARD_PATH} aria-label={`${BRAND.name} — ${BRAND.descriptor}`}>
                <Logo />
              </Link>
            </Flex>
            <NavStrip sections={sections} />
          </Box>
        </Theme>
      </Box>

      <Box
        asChild
        width={{ initial: "100%", sm: "240px" }}
        flexShrink="0"
        display={{ initial: "none", sm: "block" }}
      >
        <aside>
          <Theme appearance="dark" asChild>
            <Flex
              direction="column"
              height="100%"
              style={{
                borderRight: "1px solid var(--gray-a5)",
                // Painted explicitly rather than left to Radix's automatic
                // hasBackground, because the token the rail wants is not
                // the same one in both modes. In LIGHT this resolves,
                // inside the rail's own dark subtree, to exactly what
                // Radix would have painted anyway (--color-background =
                // the dark scale's --gray-1) — the rail is unchanged. In
                // DARK it becomes --gray-2, one step ABOVE the canvas, so
                // the rail reads as a raised surface instead of
                // disappearing into a near-identical near-black.
                background: theme.chromeBackground,
              }}
            >
              <Box p="4">
                <Link href={DASHBOARD_PATH} aria-label={`${BRAND.name} — ${BRAND.descriptor}`}>
                  {/* Wordmark auto-inverts to white here — globals.css's
                      .radix-themes.dark rule, now live on this subtree. */}
                  <Logo />
                </Link>
                <Text as="div" size="1" color="gray" mt="1">
                  {BRAND.descriptor}
                </Text>
              </Box>
              <NavRail accountName={account.legal_name} sections={sections} />
            </Flex>
          </Theme>
        </aside>
      </Box>

      <Flex direction="column" flexGrow="1" minWidth="0">
        {/* Sticky, on a solid page-ground background so content scrolls
            under it cleanly — no backdrop-filter (banned outside tokens,
            and unnecessary on a solid ground). zIndex 1 keeps it above
            the canvas but below the skip link (zIndex 1000). */}
        <Flex
          asChild
          align="center"
          justify="end"
          gap="3"
          px="4"
          py="2"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            background: theme.chromeBackground,
            borderBottom: "1px solid var(--gray-a4)",
          }}
        >
          <header>
            <Text size="1" color="gray">
              {user.email}
            </Text>
            {/* A form, not a link: signing out mutates session state, and
                a GET that a prefetcher or a link-scanner can fire would
                end the session behind the pilot's back. */}
            <form action={signOut}>
              <Button type="submit" size="1" variant="soft" color="gray">
                Sign out
              </Button>
            </form>
          </header>
        </Flex>

        {/* The canvas: gray-2 ground behind every page, so the (now
            surface-by-default) Cards sit on it as white panels — the
            Mercury/Stripe canvas-and-panel hierarchy, all tokens. */}
        <Box
          asChild
          flexGrow="1"
          p={{ initial: "4", md: "5" }}
          style={{ background: theme.canvasBackground }}
        >
          {/* The skip link's target. tabIndex={-1} makes it a valid
              programmatic focus target without adding it to the normal
              Tab order. */}
          <main id="main-content" tabIndex={-1}>
            <Container size="4">
              {readOnly ? (
                <Box mb="4">
                  <Callout.Root color="amber">
                    <Callout.Text>
                      Your subscription has ended, so this account is
                      read-only — everything stays viewable and exportable,
                      and nothing is deleted. Reading and export still work;
                      resubscribe to make changes again.{" "}
                      <Link href="/settings/billing">Go to Billing</Link>.
                    </Callout.Text>
                  </Callout.Root>
                </Box>
              ) : null}
              {children}
            </Container>
          </main>
        </Box>

        <Box px="5" py="4">
          <Separator size="4" mb="4" />
          {/* The one place AMG is named in the whole product — decision
              #18. Not the rail, not the header, never an invoice PDF. */}
          <Text size="1" color="gray">
            {BRAND.attribution}
          </Text>
        </Box>
      </Flex>
    </Flex>
    </Theme>
  );
}
