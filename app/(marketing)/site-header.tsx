import NextLink from "next/link";
import { lButtonClass } from "@/components/ledger";
import { BRAND } from "@/lib/brand";

/**
 * The public site's header. Deliberately not the (app) rail's Logo
 * component — that inlines the older in-app kit
 * (components/logo.tsx), and the owner's brand-mark decision for the
 * signed-out surface is the newer public/brand/*.svg kit (navy.svg here,
 * on this light ground). The two marks are different geometry; using the
 * in-app one on the marketing site would put two different "V1" marks in
 * front of the same visitor within one signup flow.
 *
 * LEDGER PASS: the old floating "chrome" treatment (a hand-rolled
 * translucent, blurred bar reached through `.i-chrome`/`.i-chrome-edge`)
 * is retired with the rest of INSTRUMENT's marketing furniture. This is a
 * plain sticky bar on Ledger's own card ground with a hairline beneath it
 * — the same restrained register the rest of this migration uses, and one
 * fewer bespoke visual effect to carry forward.
 *
 * A plain <img>, not next/image: this is a small, already-optimized SVG
 * with no responsive srcset to gain from the Image component, and asset
 * files under public/ are outside scripts/verify-tokens.mjs's scan
 * entirely, so there is nothing here for that script to check either way.
 */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-hair bg-card/90 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <NextLink
            href="/"
            aria-label={`${BRAND.name}, ${BRAND.descriptor}`}
            className="flex items-center"
          >
            <img src="/brand/navy.svg" alt="" height={22} width={38} />
          </NextLink>

          <div className="flex flex-wrap items-center gap-5">
            {/* Anchor into the landing page's outputs section — an
                absolute path so it works from /pricing too. Hidden on the
                narrowest screens so the four header items never push the
                CTA to a second row on a phone. */}
            <NextLink
              href="/#how-it-works"
              className="hidden text-body-s text-ink-2 hover:text-ink sm:inline"
            >
              How it works
            </NextLink>
            <NextLink href="/pricing" className="text-body-s text-ink-2 hover:text-ink">
              Pricing
            </NextLink>
            <NextLink href="/login" className="text-body-s text-ink-2 hover:text-ink">
              Log in
            </NextLink>
            <NextLink href="/signup" className={lButtonClass({ size: "sm" })}>
              Start free trial
            </NextLink>
          </div>
        </div>
      </div>
    </header>
  );
}
