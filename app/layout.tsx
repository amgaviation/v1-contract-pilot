import type { Metadata, Viewport } from "next";
import { Theme } from "@/components/ui";
import "@radix-ui/themes/styles.css";
import { fontVariables } from "@/lib/fonts";
import { BRAND, THEME_COLOR } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: `${BRAND.name} — ${BRAND.descriptor}`,
    template: `%s | ${BRAND.name}`,
  },
  // THE ONE DESCRIPTION, and it is now a crawlable marketing claim rather
  // than an internal string. app/(marketing)/layout.tsx makes "/", /pricing,
  // /terms and /privacy indexable on the production deployment, and it
  // redeclares `robots` ONLY — Next resolves each metadata field at the
  // nearest segment that sets it, so those four public pages inherit this
  // sentence verbatim into search results and link previews.
  //
  // It used to end "...logbook entry, invoice, and expenses all post from
  // it", and that clause is false. Nothing in this product creates an
  // expense from a trip: expenses come from the pilot, a scanned receipt,
  // or a bank import, and a trip is what they get ATTACHED to. Three
  // separate screens had already been corrected for exactly this — the
  // landing hero, the Trips feature card, and /welcome each carry a comment
  // saying so — while the sentence a stranger would actually read on Google
  // still advertised generation that does not exist. Corrected here, at the
  // root, rather than by adding a second description to the marketing
  // layout: two copies of a claim are two things to keep in step, and this
  // repo's whole quality bar (docs/research/FLIGHTDEPTPRO-INSPIRATION.md
  // section B) is one source of truth per fact.
  //
  // Kept in step with app/(marketing)/page.tsx's hero. If that copy changes,
  // change this with it.
  description:
    "Log the trip once — your logbook draft and your invoice lines come from it, and your receipts attach to it. A business tool for independent contract pilots.",
  // Kept noindex product-wide even now that the Phase 1 auth gate is in
  // place (app/(app)/layout.tsx redirects anyone without a session to
  // /login). A product whose trust story is "AMG cannot see your client
  // list" has no reason to invite a crawler onto its authenticated
  // surface, and the login page itself carries no content worth indexing.
  robots: { index: false, follow: false },
  // From the V1 logo kit's README, adapted to Next's metadata API (which
  // renders these as <link> tags itself — no manual markup in the <head>
  // below). The SVG favicon carries the mark's real geometry at any size;
  // PNG sizes are the fallback chain for browsers that don't yet support
  // svg favicons. There is no "dark" favicon variant: browser chrome
  // (where a favicon renders) is outside this app's theme scope, so the
  // kit's light-ground file is correct for every user.
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  // One value: the <Theme> below is pinned appearance="light", so there is
  // no dark browser chrome to match and no media-query split is needed.
  themeColor: THEME_COLOR,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        {/*
          THE ENTIRE VISUAL SYSTEM IS THIS ONE ELEMENT.

          Radix Themes owns every colour, radius, space step and type
          ramp in the product. There is no token file to maintain, no
          theme object to extend, and no component stylesheet — restyling
          the app means changing the props below (plus the one small
          defaults file, components/ui/index.tsx, that holds component-level
          defaults such as Card's variant) and nothing else. That is the
          whole reason this product is on Radix Themes rather than a
          hand-built system: the previous three attempts each died the
          same way, as a written spec that the code drifted away from.

          The six knobs, and why each is set where it is:

          accentColor="blue"    The nearest Radix scale to the logo's
                                Signal Blue (#036BFC). The mark itself is
                                NOT retinted from this — see globals.css:
                                the wordmark and bug are brand constants.
          grayColor="auto"      Pairs the grey to the accent. For a blue
                                accent, Radix's getMatchingGrayColor
                                resolves "auto" to slate — the same cool
                                grey this product used when the prop was
                                set explicitly — so nothing changes today.
                                What changes is the coupling: if the accent
                                colour is ever changed, the grey moves with
                                it automatically instead of staying frozen
                                at a stale choice. lib/brand.ts's
                                THEME_COLOR literal asserts the slate-1
                                match explicitly and must be re-checked if
                                the accent changes.
          radius="none"         This is a dense business tool, not a
                                consumer app. No corner treatment at all —
                                an explicit owner choice, not a default.
          scaling="90%"         Tighter than Radix's default, so a month of
                                trips or a year of logbook entries fits
                                without scrolling.
          panelBackground="solid"
                                The one idea worth carrying over from the
                                design system this replaces: a pilot
                                compares a column of decimal hours, and a
                                translucent panel behind a figure trades
                                legibility for decoration. Radix's default
                                is "translucent"; this product opts out.
          appearance="light"    The app is pinned to light and no longer
                                follows the reader's OS preference. This
                                replaces the earlier "inherit from a
                                `.light`/`.dark` class, stamped by an inline
                                <head> script reading matchMedia" approach.
                                That script and the second (dark)
                                `viewport.themeColor` entry existed only to
                                serve OS-following dark mode; with
                                appearance pinned, both were dead weight and
                                have been removed, along with the
                                `suppressHydrationWarning` on <html> that
                                existed only to tolerate the script stamping
                                a class the server couldn't know about.
        */}
        <Theme
          accentColor="blue"
          grayColor="auto"
          radius="none"
          scaling="90%"
          panelBackground="solid"
          appearance="light"
        >
          {children}
        </Theme>
      </body>
    </html>
  );
}
