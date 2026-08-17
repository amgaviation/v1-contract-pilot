import NextLink from "next/link";
import { lButtonClass } from "@/components/ledger";
import { BRAND } from "@/lib/brand";

/**
 * The public site's header. Deliberately not the (app) rail's Logo
 * component — that inlines the older in-app kit (components/logo.tsx), and
 * the owner's brand-mark decision for the signed-out surface is the newer
 * public/brand/*.svg kit. The two marks are different geometry; using the
 * in-app one on the marketing site would put two different brand marks in
 * front of the same visitor within one signup flow.
 *
 * ON THE NAVY, AND WHY THE MARK FILE CHANGED. This bar used to be Ledger's
 * card ground with navy.svg on it. It now sits on --ledger-brand and
 * carries white.svg, which is the same mark from the same kit inverted for
 * a dark ground exactly as the kit itself draws it (public/brand/*.svg are
 * all navy-ground-with-white-mark). The reason is continuity rather than
 * decoration: the landing hero is a full-bleed navy band, and a white bar
 * stuck above it read as a seam across the top of the page. Sticky and
 * opaque, not translucent — a blurred bar over a moving product screenshot
 * is a legibility problem, and the old hand-rolled `.i-chrome` treatment
 * was already retired once for being a bespoke effect nobody needed.
 *
 * The bar keeps the brand on /pricing, /terms and /privacy too, where
 * there is no navy band beneath it. That is the point: those pages had no
 * brand presence above the fold at all.
 *
 * A plain <img>, not next/image: this is a small, already-optimized SVG
 * with no responsive srcset to gain from the Image component, and asset
 * files under public/ are outside scripts/verify-tokens.mjs's scan
 * entirely, so there is nothing here for that script to check either way.
 */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 bg-brand text-brand-ink">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <NextLink
            href="/"
            aria-label={BRAND.name}
            className="flex items-center gap-2.5 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent"
          >
            <img src="/brand/white.svg" alt="" height={22} width={38} />
          </NextLink>

          <div className="flex flex-wrap items-center gap-5">
            {/* Anchor into the landing page's mechanic section — an absolute
                path so it works from /pricing too. Hidden on the narrowest
                screens so the four header items never push the CTA to a
                second row on a phone. */}
            <NextLink
              href="/#how-it-works"
              className="hidden text-body-s text-brand-ink-2 hover:text-brand-ink sm:inline"
            >
              How it works
            </NextLink>
            <NextLink
              href="/pricing"
              className="text-body-s text-brand-ink-2 hover:text-brand-ink"
            >
              Pricing
            </NextLink>
            <NextLink
              href="/login"
              className="text-body-s text-brand-ink-2 hover:text-brand-ink"
            >
              Log in
            </NextLink>
            <NextLink
              href="/signup"
              className={lButtonClass({ size: "sm", variant: "onBrand" })}
            >
              Get started
            </NextLink>
          </div>
        </div>
      </div>
    </header>
  );
}
