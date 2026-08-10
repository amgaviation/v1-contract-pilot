import type { MetadataRoute } from "next";

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
        "/overview",
        "/trips",
        "/clients",
        "/invoices",
        "/expenses",
        "/logbook",
        "/documents",
        "/reports",
        "/settings",
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
