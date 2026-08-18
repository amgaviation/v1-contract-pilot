import NextLink from "next/link";
import { BRAND } from "@/lib/brand";

/**
 * The public site's footer — the SECOND of the two places BRAND.attribution
 * is allowed to render (see lib/brand.ts's header comment; the first is
 * the app shell's own footer). Nowhere else on this route group prints
 * "AMG" — not the header above, not a page body — matching the rule the
 * app layout already follows.
 *
 * ON THE NAVY, CONTINUOUS WITH THE PAGE'S CLOSING BAND. This footer used
 * to sit on `bg-sunk`, which made the bottom of the landing page read as
 * navy call-to-action, then a grey strip, then nothing. It is now the same
 * --ledger-brand ground as that band, separated by a brand hairline
 * instead of a change of colour, so the page ends on one dark base. The
 * mark is white.svg for the same reason the header's is: it is the kit's
 * own inversion for a navy ground, not a recolour.
 *
 * The attribution is real rendered text sourced from lib/brand.ts, not
 * baked into an image: public/brand/expanded.svg carries the same words
 * inside its artwork, but an SVG's text isn't selectable or reachable by a
 * screen reader, and the house rule is that this string comes from the
 * constant, not from a picture of the constant.
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
      { href: "/signup", label: "Get started" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
    ],
  },
  // THE ONE WAY TO REACH A PERSON before entering a card. The product had
  // no contact route at all until now, on a funnel with no trial: a
  // prospect whose question the two FAQs happen not to answer could either
  // pay to find out or leave. mailto: rather than a form, because a form is
  // a surface to build and this is an address that already works.
  {
    heading: "Support",
    links: [{ href: `mailto:${BRAND.supportEmail}`, label: "Email us" }],
  },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-brand-hair bg-brand text-brand-ink">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="flex flex-col gap-6 py-8">
          <nav
            aria-label="Footer"
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5"
          >
            <div className="flex flex-col items-start gap-2">
              <img src="/brand/white.svg" alt="" height={16} width={28} />
              <p className="text-caption text-brand-ink-2">{BRAND.tagline}</p>
            </div>

            {COLUMNS.map((column) => (
              <div key={column.heading} className="flex flex-col gap-2">
                <span className="font-mono text-caption font-medium uppercase tracking-widest text-brand-accent">
                  {column.heading}
                </span>
                {column.links.map((link) =>
                  // A mailto: is not a route. next/link would render an
                  // anchor either way, but it exists to prefetch and
                  // client-navigate internal paths, and neither is a thing
                  // a mail client can be asked to do.
                  link.href.startsWith("mailto:") ? (
                    <a
                      key={link.href}
                      href={link.href}
                      className="text-caption text-brand-ink-2 hover:text-brand-ink"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <NextLink
                      key={link.href}
                      href={link.href}
                      className="text-caption text-brand-ink-2 hover:text-brand-ink"
                    >
                      {link.label}
                    </NextLink>
                  )
                )}
              </div>
            ))}
          </nav>

          <hr className="border-0 border-t border-brand-hair" />

          <p className="text-caption text-brand-ink-2">{BRAND.attribution}</p>
        </div>
      </div>
    </footer>
  );
}
