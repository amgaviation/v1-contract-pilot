import Link from "next/link";
import {
  Box,
  Button,
  Callout,
  Flex,
  Separator,
  Text,
} from "@/components/ui";
import { Logo } from "@/components/ui/logo";
import { BRAND } from "@/lib/brand";
import { DASHBOARD_PATH } from "@/lib/nav";
import type { NavItem } from "@/lib/nav";
import type { ResolvedTheme } from "@/lib/theme-slots";
import { NavRail, NavStrip } from "./nav-rail";
import SkipLink from "./skip-link";

/**
 * THE AUTHENTICATED SHELL — chrome only, no data access.
 *
 * This is the markup that used to live inline in app/(app)/layout.tsx.
 * It was pulled out for one reason: the layout is behind requireAccount(),
 * so the shell could never be rendered without a real session and a real
 * tenant, which meant the responsive behaviour of EVERY page in the
 * product — the thing that decides what a pilot sees on a phone, on an
 * iPad in the FBO, and on a laptop at 150% browser zoom — was the one
 * part of the product with no way to test it. It got eyeballed, and it
 * drifted.
 *
 * Everything here is presentational and takes props. app/(app)/layout.tsx
 * does the session read and passes the results in; the layout harness
 * (app/(dev)/layout-harness, development-only) passes fixtures and is
 * measured across a width matrix by scripts/layout-verify.mjs. Both render
 * the SAME component, so the harness cannot pass while the product fails.
 *
 * If you add chrome, add it here, not in layout.tsx — otherwise it is
 * invisible to the verify script again.
 *
 * ── THE BREAKPOINT, AND WHY IT IS `md` AND NOT `sm` ──────────────────
 *
 * The rail switches on at `md` (1024px), not `sm` (768px) where it used
 * to. Between 768 and 1023 the old layout planted a fixed 240px rail in
 * front of the canvas and left the page 528px of usable width after the
 * canvas padding — narrower than the phone strip layout gives at the
 * SAME viewport, because there the whole width is the page's. That band
 * is not a rare edge: it is iPad portrait (768 and 834), it is a split
 * window on a laptop, and — the case that actually gets hit daily — it
 * is an ordinary 1280px or 1440px desktop at 150–175% browser zoom.
 * Browser zoom does not scale the viewport, it shrinks it measured in CSS
 * pixels: a 1440px monitor at 175% is an 823px viewport, which landed
 * squarely in the crushed band. Moving the switch to `md` means the
 * cramped two-column arrangement no longer exists at any width; below
 * 1024 you get the full-width strip layout, which is the better of the
 * two shapes there in every case.
 *
 * `md` is also the width Radix's own `md` uses (a literal
 * `@media (min-width: 1024px)`), so this switches in lockstep with every
 * `md` a page below it declares, instead of 256px before them.
 */
export function AppShell({
  userEmail,
  accountName,
  sections,
  theme,
  readOnly,
  signOutAction,
  children,
}: {
  userEmail: string;
  accountName: string;
  sections: readonly NavItem[];
  theme: ResolvedTheme;
  readOnly: boolean;
  signOutAction: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  // THE TENANT THEME, as three data attributes rather than a component.
  // app/design/tokens.css declares the whole palette against
  // [data-appearance] / [data-accent] / [data-density], and custom properties
  // inherit — so stamping them here re-declares the palette for this subtree
  // and nothing else. It is also the entire mechanism for the dark rail
  // below, which carries data-appearance="dark" and inherits a dark palette
  // with no second stylesheet and no component-level override.
  return (
    <Box
      data-appearance={theme.appearance}
      data-accent={theme.accent}
      data-density={theme.density}
      asChild
    >
      {/* 100dvh, not 100vh. On mobile Safari and Chrome, 100vh is the
          viewport with the URL bar RETRACTED, so a page that exactly
          fills the screen is ~60-90px taller than the screen actually
          showing: every screen in the product had a scroll nub on a
          phone even when it had nothing to scroll, and the footer sat
          under the browser chrome. dvh is the dynamic viewport height —
          the real one, now, whichever way the bar is. */}
      <Flex direction={{ initial: "column", md: "row" }} minHeight="100dvh">
        <SkipLink />

        {/* The narrow-width top bar — logo plus a horizontally scrolling
            section strip. Always rendered (never conditionally mounted):
            only `display` toggles across the breakpoint, so switching
            pages never adds or removes these nodes and never shifts
            layout. The dark theme paints its own ground; the border
            lives inside it (dark-scale hairline).

            Sticky, like the desktop header is. On a phone the strip IS
            the navigation — leaving it to scroll away meant that getting
            from the bottom of a long invoice list to another section was
            a scroll to the top first. */}
        <Box
          display={{ initial: "block", md: "none" }}
          style={{ position: "sticky", top: 0, zIndex: 2 }}
        >
          <Box data-appearance="dark" asChild>
            <Box
              style={{
                borderBottom: "1px solid var(--gray-a5)",
                background: theme.chromeBackground,
              }}
            >
              <Flex align="center" gap="2" px="3" pt="3">
                <Link
                  href={DASHBOARD_PATH}
                  aria-label={`${BRAND.name} — ${BRAND.descriptor}`}
                >
                  <Logo />
                </Link>
              </Flex>
              <NavStrip sections={sections} />
            </Box>
          </Box>
        </Box>

        <Box
          asChild
          width={{ initial: "100%", md: "240px" }}
          flexShrink="0"
          display={{ initial: "none", md: "block" }}
        >
          <aside>
            <Box data-appearance="dark" asChild>
              <Flex
                direction="column"
                height="100%"
                style={{
                  borderRight: "1px solid var(--gray-a5)",
                  // Painted explicitly rather than left to Radix's
                  // automatic hasBackground, because the token the rail
                  // wants is not the same one in both modes. In LIGHT
                  // this resolves, inside the rail's own dark subtree, to
                  // exactly what Radix would have painted anyway
                  // (--color-background = the dark scale's --gray-1). In
                  // DARK it becomes --gray-2, one step ABOVE the canvas,
                  // so the rail reads as a raised surface instead of
                  // disappearing into a near-identical near-black.
                  background: theme.chromeBackground,
                  // The rail is as tall as the viewport and scrolls its
                  // own overflow. Without this, a tenant who has every
                  // section visible at 110% density on a short window
                  // (a laptop at 175% zoom is ~430px tall) pushed the
                  // account block off the bottom of the page with no way
                  // to reach it, and the whole PAGE grew to the rail's
                  // height so every screen scrolled vertically by the
                  // rail's overhang.
                  position: "sticky",
                  top: 0,
                  height: "100dvh",
                  overflowY: "auto",
                }}
              >
                <Box p="4">
                  <Link
                    href={DASHBOARD_PATH}
                    aria-label={`${BRAND.name} — ${BRAND.descriptor}`}
                  >
                    {/* Wordmark auto-inverts to white here — globals.css's
                        .radix-themes.dark rule, live on this subtree. */}
                    <Logo />
                  </Link>
                  <Text as="div" size="1" color="gray" mt="1">
                    {BRAND.descriptor}
                  </Text>
                </Box>
                <NavRail accountName={accountName} sections={sections} />
              </Flex>
            </Box>
          </aside>
        </Box>

        <Flex direction="column" flexGrow="1" minWidth="0">
          {/* Sticky, on a solid page-ground background so content scrolls
              under it cleanly — no backdrop-filter (banned outside tokens,
              and unnecessary on a solid ground). zIndex 1 keeps it above
              the canvas but below the skip link (zIndex 1000).

              Hidden below `md`: at phone and tablet-portrait widths the
              sticky section strip is already occupying the top of the
              screen, and stacking a second sticky bar under it spent
              ~40px of a 640px-tall phone screen on an email address. The
              same email and the same Sign out button are reachable from
              Settings, which is the last entry in the strip. */}
          <Flex
            asChild
            align="center"
            justify="end"
            gap="3"
            px="4"
            py="2"
            display={{ initial: "none", md: "flex" }}
            style={{
              position: "sticky",
              top: 0,
              zIndex: 1,
              background: theme.chromeBackground,
              borderBottom: "1px solid var(--gray-a4)",
            }}
          >
            <header>
              {/* minWidth 0 + truncate: an email is user-supplied and
                  unbounded, and a flex item will not shrink below its
                  content without it. A long address pushed the Sign out
                  button off the right edge of the header — the one
                  control on the shell that must never be unreachable. */}
              <Box minWidth="0" style={{ overflow: "hidden" }}>
                <Text
                  size="1"
                  color="gray"
                  truncate
                  title={userEmail}
                  as="div"
                >
                  {userEmail}
                </Text>
              </Box>
              {/* A form, not a link: signing out mutates session state, and
                  a GET that a prefetcher or a link-scanner can fire would
                  end the session behind the pilot's back. */}
              <form action={signOutAction}>
                {/* size="2", not "1". At the Theme's 90% scaling a size-1
                    Button computes to 59x22 CSS px, and WCAG 2.5.8 (AA,
                    Target Size (Minimum)) requires 24x24 — measured, not
                    estimated, by scripts/layout-verify.mjs, which is how
                    this was found. size="2" computes to 28.8px high and
                    clears it. It is the same correction, for the same
                    reason, that components/ui/index.tsx already applied
                    to TextField.Root's default. */}
                <Button
                  type="submit"
                  size="2"
                  variant="soft"
                  color="gray"
                  style={{ flexShrink: 0 }}
                >
                  Sign out
                </Button>
              </form>
            </header>
          </Flex>

          {/* The canvas: gray-2 ground behind every page, so the (surface-
              by-default) Cards sit on it as white panels — the
              Mercury/Stripe canvas-and-panel hierarchy, all tokens. */}
          <Box
            asChild
            flexGrow="1"
            p={{ initial: "3", xs: "4", md: "5" }}
            minWidth="0"
            style={{ background: theme.canvasBackground }}
          >
            {/* The skip link's target. tabIndex={-1} makes it a valid
                programmatic focus target without adding it to the normal
                Tab order. */}
            <main id="main-content" tabIndex={-1}>
              {/* Was <Container size="4">, a hard 1136px cap. This product
                  is data-dense by design — the year-end packet, trip P&L
                  and pilot-history reports are ten- and twelve-column
                  tables — and on a 1728px or 1920px monitor that cap left
                  ~550px of empty canvas beside a table that was scrolling
                  horizontally inside its own frame. A pilot with a big
                  screen should get to USE it. The ladder keeps the narrow
                  measure where it helps (a settings form at 1136px is
                  already at the edge of comfortable line length) and only
                  opens up on screens that have the room. */}
              <Box
                mx="auto"
                minWidth="0"
                maxWidth={{
                  initial: "100%",
                  md: "1136px",
                  lg: "1280px",
                  xl: "1536px",
                }}
              >
                {readOnly ? (
                  <Box mb="4">
                    <Callout.Root color="amber">
                      <Callout.Text>
                        Your subscription has ended, so this account is
                        read-only — everything stays viewable and
                        exportable, and nothing is deleted. Reading and
                        export still work; resubscribe to make changes
                        again. <Link href="/settings/billing">Go to Billing</Link>.
                      </Callout.Text>
                    </Callout.Root>
                  </Box>
                ) : null}
                {children}
              </Box>
            </main>
          </Box>

          <Box px={{ initial: "3", md: "5" }} py="4">
            <Separator size="4" mb="4" />
            {/* The one place AMG is named in the whole product — decision
                #18. Not the rail, not the header, never an invoice PDF. */}
            <Text size="1" color="gray">
              {BRAND.attribution}
            </Text>
          </Box>
        </Flex>
      </Flex>
    </Box>
  );
}
