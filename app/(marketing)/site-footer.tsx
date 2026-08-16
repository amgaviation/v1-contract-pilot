import NextLink from "next/link";
import { LSeparator } from "@/components/ledger";
import { BRAND } from "@/lib/brand";

/**
 * The public site's footer — the SECOND of the two places BRAND.attribution
 * is allowed to render (see lib/brand.ts's header comment; the first is
 * the app shell's own footer). Nowhere else on this route group prints
 * "AMG" — not the header above, not a page body — matching the rule the
 * app layout already follows.
 *
 * LEDGER PASS: the gray-2 band the old footer sat on (lib/surface-style.ts
 * GRAY_BAND) is `bg-sunk` here — Ledger's own quiet-fill token, the same
 * one the section rhythm below uses, so the footer closes the page as one
 * more band of the canvas/sunk system rather than its own third gray.
 *
 * The attribution is real rendered text sourced from lib/brand.ts, not
 * baked into an image: public/brand/expanded.svg carries the same words
 * inside its artwork, but an SVG's text isn't selectable or reachable by a
 * screen reader, and the house rule is that this string comes from the
 * constant, not from a picture of the constant. The mark next to it is
 * navy.svg (the bare V1 shape, no wordtext) on this light footer ground —
 * the same file site-header.tsx uses, for the same reason.
 */
const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/login", label: "Log in" },
      { href: "/signup", label: "Start free trial" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-hair bg-sunk">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex flex-col gap-5 py-6">
          <nav
            aria-label="Footer"
            className="grid grid-cols-1 gap-5 sm:grid-cols-4"
          >
            <div className="flex flex-col items-start gap-2">
              <img src="/brand/navy.svg" alt="" height={16} width={28} />
              <p className="text-caption text-ink-3">{BRAND.tagline}</p>
            </div>

            {COLUMNS.map((column) => (
              <div key={column.heading} className="flex flex-col gap-2">
                <span className="text-caption font-medium text-ink-3">
                  {column.heading.toUpperCase()}
                </span>
                {column.links.map((link) => (
                  <NextLink
                    key={link.href}
                    href={link.href}
                    className="text-caption text-ink-3 hover:text-ink"
                  >
                    {link.label}
                  </NextLink>
                ))}
              </div>
            ))}
          </nav>

          <LSeparator className="my-0" />

          <p className="text-caption text-ink-3">{BRAND.attribution}</p>
        </div>
      </div>
    </footer>
  );
}
