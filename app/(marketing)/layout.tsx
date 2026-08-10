import type { Metadata } from "next";
import { Flex } from "@/components/ui";
import SiteHeader from "./site-header";
import SiteFooter from "./site-footer";

/**
 * The signed-out marketing surface: "/", "/pricing", "/terms", "/privacy"
 * (app/(marketing)/{page,pricing,terms,privacy}.tsx). A route group, same
 * mechanism app/(app) and app/(auth) already use — it does not change any
 * URL, it just gives these four pages one shared header/footer instead of
 * each re-declaring it.
 *
 * `robots` here overrides the product-wide `index: false, follow: false`
 * set in app/layout.tsx. Next's metadata resolution replaces a field
 * wholesale at the nearest segment that redeclares it, so this object is
 * the WHOLE robots directive for every page below it, not a merge with the
 * root's — these four pages are the only public-facing surface this
 * product has any reason to let a crawler see; the authenticated product
 * stays noindex exactly as app/layout.tsx's own comment explains.
 */
/**
 * INDEXABLE ONLY ON THE PRODUCTION DEPLOYMENT, and that condition is the whole
 * point. docs/LAUNCH-GATES.md G2 and G7 both draw their line at "existing in
 * the repo and rendering on a preview host is not publishing" — that carve-out
 * is only honest if a preview genuinely cannot be found by a stranger. A flat
 * `index: true` made it false: every preview deployment of every branch would
 * have invited crawlers to an unsigned price and to counsel-gated feature
 * copy, which is exactly what those gates exist to prevent.
 *
 * VERCEL_ENV is "production", "preview" or "development", and is absent on a
 * local machine — so anything that is not the production deployment reads as
 * not-production and stays noindex. Erring that way costs nothing: the worst
 * case is that the real site needs one deploy to become indexable, whereas the
 * opposite default leaks a price the owner has not signed.
 */
const isProductionDeployment = process.env.VERCEL_ENV === "production";

export const metadata: Metadata = {
  robots: { index: isProductionDeployment, follow: true },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Flex direction="column" minHeight="100vh">
      <SiteHeader />
      <Flex flexGrow="1" direction="column" asChild>
        <main>{children}</main>
      </Flex>
      <SiteFooter />
    </Flex>
  );
}
