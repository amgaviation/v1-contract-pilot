import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import { BRAND, THEME_COLOR } from "@/lib/brand";
import "./design/ledger.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: `${BRAND.name}: ${BRAND.descriptor}`,
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
    "The books for your flying business: who owes you, what you earned, what you spent, and the year-end packet your CPA asks for. Built for independent contract pilots.",
  // Kept noindex product-wide even now that the Phase 1 auth gate is in
  // place (app/(app)/layout.tsx redirects anyone without a session to
  // /login). A product whose trust story is "AMG cannot see your client
  // list" has no reason to invite a crawler onto its authenticated
  // surface, and the login page itself carries no content worth indexing.
  robots: { index: false, follow: false },
  // Rendered from the current brand mark (public/brand/navy.svg geometry)
  // by scripts/generate-pwa-icons.mjs; Next's metadata API renders these
  // as <link> tags itself — no manual markup in the <head> below. The SVG
  // favicon carries the mark's real geometry at any size; PNG sizes are
  // the fallback chain for browsers that don't yet support svg favicons.
  // There is deliberately no "dark" variant: the mark sits on its own
  // navy rounded square, so one file is legible on light and dark browser
  // chrome alike.
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
  // One value: the root is stamped data-appearance="light" below, so there is
  // no dark browser chrome to match and no media-query split is needed. A
  // tenant who chooses dark gets it inside the authenticated shell; the
  // browser chrome on the signed-out surface stays light either way.
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
    <html
      lang="en"
      className={fontVariables}
      // THE DESIGN SYSTEM IS app/design/ledger.css plus [data-appearance].
      // [data-accent] and [data-density] are stamped here for parity with
      // the app shell and lib/theme-slots.ts's ResolvedTheme shape, but
      // Ledger has no CSS rule keyed on either (see the note above
      // ACCENT_SLOTS in lib/theme-slots.ts) — only data-appearance (day/
      // night) has any visual effect. Custom properties inherit, so the
      // root defaults set here are what every page gets, and the
      // authenticated shell re-stamps them from the tenant's saved
      // preferences for its own subtree (app/(app)/app-shell.tsx).
      //
      // The signed-out surface — marketing, auth, the public invoice and
      // packet pages — deliberately never reads a preference and stays on
      // these defaults. A pilot's client opening an invoice link should see
      // the product's own look, not the pilot's chosen accent.
      data-appearance="light"
      data-accent="indigo"
      data-density="compact"
    >
      <body>

        {children}
      </body>
    </html>
  );
}
