"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "@/lib/brand";

/**
 * The auth surface's brand row: the lockup on the left, a way back to the
 * public site on the right.
 *
 * WHY THIS IS A CLIENT COMPONENT, for one boolean. Everything under
 * app/(auth) shares one layout, but the routes do not share one audience.
 * /login, /signup, /forgot-password, /reset-password, /check-email and
 * /link-expired are read by a SIGNED-OUT visitor who arrived from the
 * marketing site and may want to go back to it. /welcome is the opposite:
 * it only renders for a visitor who is already signed in and has no tenant
 * yet (see its own page.tsx, which redirects anyone else), and "/" would
 * bounce them straight back here. A server layout cannot read the pathname,
 * so the smallest honest mechanism is this one hook. Adding a route to the
 * group gets the back link by default, which is the safe direction to fail:
 * a stray link home costs a click, a missing one strands a visitor.
 *
 * THE BADGE IS THE BRAND KIT'S OWN LOCKUP, not a new invention: navy
 * rounded square, white mark inside, exactly the arrangement
 * public/brand/favicon.svg and app-icon.svg are drawn as. The mark file is
 * white.svg rather than navy.svg because it sits on the navy here. A plain
 * <img> for the same reason site-header.tsx uses one — a small, already
 * optimized SVG has no responsive srcset to gain from next/image, and
 * public/ is outside the token verifier's scan either way.
 */

/** Routes in this group that only ever render for a signed-in visitor. */
const SIGNED_IN_ROUTES = new Set(["/welcome"]);

export default function AuthBrand() {
  const pathname = usePathname();
  const showBackLink = !SIGNED_IN_ROUTES.has(pathname);

  return (
    <div className="flex items-center justify-between gap-4">
      <NextLink
        href="/"
        aria-label={BRAND.name}
        className="group flex items-center gap-2.5 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        <span className="flex size-9 items-center justify-center rounded-control bg-brand">
          <img src="/brand/white.svg" alt="" height={16} width={28} />
        </span>
      </NextLink>

      {showBackLink ? (
        <NextLink
          href="/"
          className="inline-flex items-center gap-1.5 rounded-control px-2 py-1.5 text-body-s text-ink-2 transition-colors hover:bg-sunk hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {/* Inline, not an icon dependency: one 12px chevron is cheaper as
              markup than a package, and it is decorative — the link's text
              already names the destination. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7.25 2.5 3.75 6l3.5 3.5" />
          </svg>
          Back to site
        </NextLink>
      ) : null}
    </div>
  );
}
