import NextLink from "next/link";
import { BRAND } from "@/lib/brand";

/**
 * THE SIGNED-OUT SURFACE — /signup, /login, /forgot-password,
 * /reset-password, /welcome. Each page still does its own session check;
 * this file is composition only.
 *
 * LEDGER'S SOFTER MARKETING VARIANT (docs/design/LEDGER.md's migration
 * table: "portals get the softer marketing variant"). These routes are the
 * product's other unauthenticated, public-facing surface — the same
 * posture app/vendor/[token]/page.tsx and app/packet/[token]/page.tsx
 * already render: `min-h-dvh bg-canvas font-ledger text-body text-ink` on
 * the root, one centered narrow column, no app-shell density. The old
 * two-panel navy brand split (components/ui, --v1-marketing-* custom
 * properties) has no Ledger token to carry it forward — Ledger's signature
 * move is restraint, not a full-bleed gradient panel — so it is retired
 * here in favor of the mark alone, centered above the panel, exactly as a
 * visitor already sees it on /vendor/[token] and /packet/[token].
 *
 * .v1-nozoom-fields SURVIVES ON PURPOSE: app-shell.tsx (Phase 2, already
 * migrated) keeps this exact class for the identical reason — it is pure
 * touch-device font-sizing (`@media (pointer: coarse) input,textarea,select
 * { font-size: 16px }`), not a color or a value tokens:verify's VALUE rules
 * police, and every field under this layout benefits from it.
 *
 * The mark is public/brand/navy.svg, the same file/brand kit site-header.tsx
 * uses on this light ground — not components/logo.tsx, which inlines the
 * older in-app kit. A plain <img>, not next/image: a small, already-optimized
 * SVG has no responsive srcset to gain from it.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="v1-nozoom-fields min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-10 sm:px-8">
        <NextLink
          href="/"
          aria-label={`${BRAND.name}, ${BRAND.descriptor}`}
          className="flex items-center justify-center"
        >
          <img src="/brand/navy.svg" alt="" height={28} width={48} />
        </NextLink>

        {children}
      </div>
    </div>
  );
}
