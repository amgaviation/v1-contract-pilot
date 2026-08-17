import AuthBrand from "./auth-brand";
import { BRAND } from "@/lib/brand";

/**
 * THE SIGNED-OUT SURFACE — /signup, /login, /forgot-password,
 * /reset-password, /check-email, /link-expired, /welcome. Each page still
 * does its own session check; this file is composition only.
 *
 * LEDGER'S SOFTER MARKETING VARIANT (docs/design/LEDGER.md's migration
 * table: "portals get the softer marketing variant"): `min-h-dvh bg-canvas
 * font-ledger text-body text-ink` on the root, one narrow column, no
 * app-shell density.
 *
 * BRANDED, AND WITH A WAY OUT. The previous revision of this file rendered
 * one 28x48 mark, centered, linking home — and that was the entire brand
 * presence and the entire exit from the auth flow. Both were too thin. A
 * pilot who clicks "Sign in" from the marketing site landed on a screen
 * that could have belonged to any product, with no signposted way back to
 * the page they came from; the mark was a link, but nothing said so. The
 * row is now a real lockup (the brand kit's own navy badge beside the
 * descriptor) with an explicit "Back to site" link opposite it, and the
 * column is top-aligned rather than vertically centered so that row reads
 * as a header instead of floating. See auth-brand.tsx for why the back
 * link is route-aware.
 *
 * The tagline closes the column, and that plus the marketing footer is the
 * whole of its territory (docs/MARKETING.md: BRAND.tagline is not a
 * headline and never appears in the landing page body). It is deliberately
 * NOT also in the lockup above — one brand line per screen, or the surface
 * starts repeating itself. BRAND.attribution stays off this surface
 * entirely; lib/brand.ts confines it to the app footer and the marketing
 * footer.
 *
 * .v1-nozoom-fields SURVIVES ON PURPOSE: app-shell.tsx (Phase 2, already
 * migrated) keeps this exact class for the identical reason — it is pure
 * touch-device font-sizing (`@media (pointer: coarse) input,textarea,select
 * { font-size: 16px }`), not a color or a value tokens:verify's VALUE rules
 * police, and every field under this layout benefits from it.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="v1-nozoom-fields flex min-h-dvh flex-col bg-canvas font-ledger text-body text-ink">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        <AuthBrand />

        {/* The panel takes the leftover height and centers itself in it, so
            a short form (reset password) sits optically centered while a
            tall one (signup) simply grows downward instead of pushing the
            brand row off the top of a 514px-high viewport. */}
        <div className="flex flex-1 flex-col justify-center">{children}</div>

        <p className="text-caption text-ink-3">{BRAND.tagline}</p>
      </div>
    </div>
  );
}
