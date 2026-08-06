import type { Metadata, Viewport } from "next";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { fontVariables } from "@/lib/fonts";
import { BRAND, THEME_COLOR_LIGHT, THEME_COLOR_DARK } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: `${BRAND.name} — ${BRAND.descriptor}`,
    template: `%s | ${BRAND.name}`,
  },
  description:
    "Log the trip once — logbook entry, invoice, and expenses all post from it. A business tool for independent contract pilots.",
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
  // Two entries because the <Theme> below sets no `appearance` and so
  // follows the reader's own preference — a single theme-color would tint
  // the browser chrome wrong for half of them.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning because the script below stamps a class the
    // server cannot know. It is scoped to this one element, not the tree.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/*
          Stamps `.light` or `.dark` on <html> from the OS preference,
          before first paint, so Radix Themes' class-scoped dark tokens
          apply with no flash of the wrong theme.

          Inline and synchronous on purpose: anything deferred renders the
          light theme first and repaints, which is precisely the artifact a
          pilot reading this at 0500 in a hotel room would notice. Kept as
          a few lines here rather than adding a theming dependency — the
          product needs to follow the OS, not offer a picker.

          The `change` listener means unlocking the phone after the OS has
          switched to night mode doesn't leave a stale theme behind.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var m=matchMedia('(prefers-color-scheme: dark)');" +
              "var r=document.documentElement;" +
              "var set=function(d){r.classList.toggle('dark',d);r.classList.toggle('light',!d)};" +
              "set(m.matches);" +
              "m.addEventListener('change',function(e){set(e.matches)})" +
              "}catch(e){document.documentElement.classList.add('light')}})()",
          }}
        />
      </head>
      <body>
        {/*
          THE ENTIRE VISUAL SYSTEM IS THIS ONE ELEMENT.

          Radix Themes owns every colour, radius, space step and type
          ramp in the product. There is no token file to maintain, no
          theme object to extend, and no component stylesheet — restyling
          the app means changing the props below and nothing else. That is
          the whole reason this product is on Radix Themes rather than a
          hand-built system: the previous three attempts each died the
          same way, as a written spec that the code drifted away from.

          The five knobs, and why each is set where it is:

          accentColor="blue"    The nearest Radix scale to the logo's
                                Signal Blue (#036BFC). The mark itself is
                                NOT retinted from this — see globals.css:
                                the wordmark and bug are brand constants.
          grayColor="slate"     A cool grey. Radix's "auto" would pick a
                                grey tuned to the accent; slate is chosen
                                explicitly so the neutrals stay cool even
                                if the accent later changes.
          radius="small"        This is a dense business tool, not a
                                consumer app. Small keeps the corner
                                treatment present but quiet.
          scaling="95%"         Slightly tighter than Radix's default, so
                                a month of trips or a year of logbook
                                entries fits without scrolling.
          panelBackground="solid"
                                The one idea worth carrying over from the
                                design system this replaces: a pilot
                                compares a column of decimal hours, and a
                                translucent panel behind a figure trades
                                legibility for decoration. Radix's default
                                is "translucent"; this product opts out.

          appearance is absent, which means "inherit" — and inherit means
          inherit from a `.light`/`.dark` CLASS on an ancestor. It does NOT
          read the operating system. Radix Themes' stylesheet contains zero
          `prefers-color-scheme` queries; every dark token is scoped under
          `.dark`. An earlier version of this comment claimed the app
          "follows the reader's own preference" on the strength of that
          prop alone, which was false: a dark-mode reader got dark browser
          chrome (viewport.themeColor, above) framing a pure-white app.
          The inline script in <head> is what actually makes it true.
        */}
        <Theme
          accentColor="blue"
          grayColor="slate"
          radius="small"
          scaling="95%"
          panelBackground="solid"
        >
          {children}
        </Theme>
      </body>
    </html>
  );
}
