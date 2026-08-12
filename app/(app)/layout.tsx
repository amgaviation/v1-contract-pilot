import Link from "next/link";
import { Box, Button, Container, Flex, Separator, Text, Theme } from "@/components/ui";
import { Logo } from "@/components/ui/logo";
import { BRAND } from "@/lib/brand";
import { DASHBOARD_PATH, visibleNavSections } from "@/lib/nav";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";
import { requireAccount } from "@/lib/supabase/account";
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
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, account } = await requireAccount();
  const sections = visibleNavSections(isCurrencyEngineEnabled());

  return (
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
          <Box style={{ borderBottom: "1px solid var(--gray-a5)" }}>
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
              style={{ borderRight: "1px solid var(--gray-a5)" }}
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
            background: "var(--color-background)",
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
          style={{ background: "var(--gray-2)" }}
        >
          {/* The skip link's target. tabIndex={-1} makes it a valid
              programmatic focus target without adding it to the normal
              Tab order. */}
          <main id="main-content" tabIndex={-1}>
            <Container size="4">{children}</Container>
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
  );
}
