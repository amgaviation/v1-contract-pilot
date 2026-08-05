import type { Metadata, Viewport } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { fontVariables } from "@/lib/fonts";
import { BRAND, THEME_COLOR } from "@/lib/brand";
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
  // (where a favicon renders) is outside this app's [data-theme] scope, so
  // the kit's light-ground file is correct for every user regardless of
  // which theme they've picked inside the app.
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
      <head>
        {/* Material Icons font, exactly as the Material Dashboard kit's
            public/index.html linked it — the Sidenav/Navbar/Configurator
            render icons as <Icon> ligatures from this family. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css?family=Material+Icons|Material+Icons+Outlined|Material+Icons+Two+Tone|Material+Icons+Round|Material+Icons+Sharp"
        />
      </head>
      <body>
        {/* Each route group brings its own client shell: app/(app) mounts
            the full dashboard chrome (AppShell) behind the auth gate,
            app/(auth) mounts a theme-only shell for the signed-out login
            surface. The root layout stays chrome-free so nothing renders
            the Sidenav for a signed-out visitor. */}
        <AppRouterCacheProvider>{children}</AppRouterCacheProvider>
      </body>
    </html>
  );
}
