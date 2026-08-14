import type { MetadataRoute } from "next";
import { BRAND, THEME_COLOR } from "@/lib/brand";
import { DASHBOARD_PATH } from "@/lib/nav";

/**
 * The web app manifest — what lets a pilot put this product on a phone
 * home screen and have it open full-screen like an app. Next serves this
 * at /manifest.webmanifest and links it from every page's <head> itself
 * (the metadata-file convention, same mechanism as app/robots.ts).
 *
 * MANIFEST ONLY, deliberately: no service worker, no offline queue, no
 * install prompt. The offline-tolerant receipt capture the demand research
 * pairs with this (docs/research/PILOT-FEATURE-DEMAND.md #7) is real
 * follow-on work with its own failure modes (a queued upload that silently
 * never lands is a lost receipt) — an install surface that quietly implies
 * offline support it doesn't have would be the dishonest version of this
 * feature. What installing buys today: a home-screen entry, standalone
 * chrome, and the correct brand surface on the splash screen.
 *
 * Brand strings compose from lib/brand.ts — the single source for them;
 * no literal name appears here (tokens:verify enforces this). Colors are
 * THEME_COLOR — the page ground the splash screen must continue, same
 * reasoning as viewport.themeColor in app/layout.tsx.
 *
 * Icons: 192 and 512 rendered from the brand kit's app-icon.svg by
 * scripts/generate-pwa-icons.mjs (committed outputs — see that script's
 * header), plus the SVG itself for browsers that take a vector. The mark
 * is full-bleed on its navy ground, so `purpose: "any"` is honest;
 * "maskable" would need safe-zone padding the kit doesn't define, and a
 * wrongly-declared maskable icon gets its corners cropped off on Android
 * launchers, so it is deliberately not claimed.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name}: ${BRAND.descriptor}`,
    short_name: BRAND.name,
    description: BRAND.tagline,
    id: DASHBOARD_PATH,
    // The dashboard, not "/" — "/" is the public marketing page, and an
    // installed app that opens on its own marketing site would be a small
    // daily insult. Signed out, this redirects to login and back.
    start_url: DASHBOARD_PATH,
    display: "standalone",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      {
        src: "/brand/pwa-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/pwa-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
