import type { MetadataRoute } from "next";
import { NAV_SECTIONS, NAV_SETTINGS, NAV_HELP } from "@/lib/nav";

/**
 * Only "/" and "/pricing" are indexable — see app/(marketing)/layout.tsx.
 * /terms and /privacy carry their own noindex (counsel-gated placeholders
 * that say so in their own bodies) and are intentionally left off this
 * list. Everything else is the authenticated product, noindex product-wide
 * per app/layout.tsx.
 *
 * WHY THIS IS AN EXPLICIT DISALLOW LIST AND NOT `allow: ["/", "/pricing"]`
 * ALONGSIDE `disallow: "/"`. That pairing looks right and does nothing: the
 * robots.txt tie-break is by rule LENGTH, and where two rules match equally
 * the crawler resolves in favour of the least restrictive one. `Allow: /`
 * and `Disallow: /` are the same length, so `Allow` wins and the entire
 * authenticated product becomes crawlable — the rule that was supposed to
 * be the whole point of the file silently evaporates. A review caught it
 * here before it shipped.
 *
 * Naming the paths to disallow is longer to maintain but it is unambiguous:
 * a rule that only works if you reason correctly about precedence is a rule
 * that will be got wrong. The per-page `robots` metadata remains the real
 * belt-and-braces — robots.txt is a request, not an access control, and
 * nothing private is protected by either. Both are noindex hints; the
 * actual gate is lib/supabase/proxy.ts.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Matches app/(marketing)/layout.tsx: only the production deployment invites
  // crawlers at all. A preview host carries an unsigned price and
  // counsel-gated copy, and docs/LAUNCH-GATES.md G2/G7 rest on a preview not
  // being findable. Two files have to agree on this, so both read VERCEL_ENV
  // and both fail closed when it is absent.
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/pricing"],
      disallow: [
        // EVERY SIGNED-IN SECTION, derived rather than retyped. This list used
        // to spell all nine out, which made it a second copy of lib/nav.ts
        // that nothing kept in step: add a section and forget this file and
        // the new screen is crawlable by omission, and move a section — as
        // Overview was moved from "/" to "/overview" — and the disallow goes
        // on naming a route that no longer exists while the real one is
        // uncovered. Neither failure produces an error; both produce a
        // robots.txt that reads as complete. Derivation is what makes
        // "every section is disallowed" true by construction, and
        // tests/dashboard-path.test.mjs asserts it stays true.
        ...NAV_SECTIONS.map((section) => section.href),
        NAV_SETTINGS.href,
        NAV_HELP.href,
        // The rest are not nav sections and are listed on purpose.
        "/login",
        "/signup",
        "/welcome",
        "/forgot-password",
        "/reset-password",
        "/auth/",
        "/api/",
        // Token-addressed client-facing pages. Nothing links to them, but a
        // token in a crawled referrer is exactly how a private invoice ends
        // up in an index.
        "/invoice/",
        "/packet/",
        // Counsel-gated placeholders; they also carry their own noindex.
        "/terms",
        "/privacy",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
