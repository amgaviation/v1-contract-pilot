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
export const metadata: Metadata = {
  robots: { index: true, follow: true },
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
