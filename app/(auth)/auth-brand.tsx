"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "@/lib/brand";

/**
 * The auth shell's brand pieces, all three of them — the 2026-08-19
 * redesign of this surface (owner's direction: the auth screens read as
 * bland next to the branded site; make them look branded and
 * professional).
 *
 * WHAT CHANGED STRUCTURALLY. The surface used to be one narrow column
 * with a 36px navy badge as its whole brand presence, and /signup alone
 * carried a brand panel inside its own component. The panel is now the
 * SHELL's: a full-height navy column (AuthPanel) every screen in the
 * group shares at lg+, carrying the same §5-audited story the signup
 * panel carried — the strings moved here verbatim, they were not
 * rewritten. On a phone the panel folds to a navy bar (AuthMobileBar)
 * so the form stays first, which preserves the old order-last decision:
 * a visitor who tapped "Get started" gets the fields, not a billboard.
 *
 * Everything on the panel is bound by docs/MARKETING.md §5 exactly as
 * hard as the landing page (this surface has overclaimed twice; the
 * history lives in signup-form.tsx's comments). The three lines are the
 * pilot's own verbs — review, send, scan, mark — and line 3 carries
 * claim rule 1: the PILOT marks the receipt rebill. A trip never
 * creates an expense.
 *
 * A <section>, deliberately NOT an <aside>: scripts/layout-verify.mjs
 * detects the app shell by the presence of an <aside> — see the same
 * note in signup-form.tsx's history.
 *
 * "use client" for one hook: the back link hides on /welcome (a
 * signed-in-only screen where "/" would bounce straight back), and a
 * server layout cannot read the pathname. The panel itself is static;
 * riding in this file costs one cheap hydration and keeps the shell's
 * brand pieces in one place.
 */

/** Routes in this group that only ever render for a signed-in visitor. */
const SIGNED_IN_ROUTES = new Set(["/welcome"]);

const STORY: readonly string[] = [
  "Log a trip, read the invoice lines it priced off your client's rate card, and send a numbered PDF with a payment link on it.",
  "Every leg comes back as a logbook draft with PIC and SIC kept apart, waiting for you to approve it.",
  "Photograph receipts at the FBO and mark each one rebill or keep. The rebills go on that client's invoice.",
];

/** The desktop brand column: navy floor, glow, the story, the tagline. */
export function AuthPanel() {
  return (
    <section
      aria-labelledby="auth-brand-heading"
      className="relative hidden overflow-hidden bg-brand text-brand-ink lg:flex lg:flex-col"
    >
      <div aria-hidden className="mkt-glow" />
      <div className="relative flex flex-1 flex-col justify-between gap-10 px-10 py-10 xl:px-14">
        <NextLink
          href="/"
          aria-label={BRAND.name}
          className="self-start rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent"
        >
          <img src="/brand/white.svg" alt="" height={22} width={38} />
        </NextLink>

        <div className="flex max-w-md flex-col gap-5">
          <h2
            id="auth-brand-heading"
            className="font-display text-display-s font-bold text-brand-ink"
          >
            One trip entry drives the rest.
          </h2>
          <p className="text-body text-brand-ink-2">
            {BRAND.name} is a business management platform we built for
            pilots. Set up takes about two minutes and it starts working on
            the first trip you log.
          </p>
          <ul className="flex flex-col divide-y divide-brand-hair border-t border-brand-hair">
            {STORY.map((line, i) => (
              <li key={line} className="flex items-baseline gap-3 py-3">
                <span className="font-mono tnum-l text-body-s font-semibold text-brand-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-body-s text-brand-ink-2">{line}</span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-brand-ink-2">
            Account-wide export on every plan. Cancelling puts the account in
            read-only; nothing is deleted.
          </p>
        </div>

        <p className="text-caption text-brand-ink-2">{BRAND.tagline}</p>
      </div>
    </section>
  );
}

/** The phone fold of the panel: a navy bar, badge left, way out right. */
export function AuthMobileBar() {
  const pathname = usePathname();
  const showBackLink = !SIGNED_IN_ROUTES.has(pathname);
  return (
    <div className="flex items-center justify-between gap-4 bg-brand px-4 py-3 sm:px-8 lg:hidden">
      <NextLink
        href="/"
        aria-label={BRAND.name}
        className="rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent"
      >
        <img src="/brand/white.svg" alt="" height={18} width={31} />
      </NextLink>
      {showBackLink ? (
        <NextLink
          href="/"
          className="text-body-s text-brand-ink-2 transition-colors hover:text-brand-ink"
        >
          Back to site
        </NextLink>
      ) : null}
    </div>
  );
}

/** The desktop way out, top of the form column. Hidden on /welcome for
 *  the same reason the old brand row hid it there: that screen only
 *  renders signed-in, and "/" would bounce straight back. */
export function AuthBackLink() {
  const pathname = usePathname();
  if (SIGNED_IN_ROUTES.has(pathname)) return <div aria-hidden />;
  return (
    <NextLink
      href="/"
      className="inline-flex items-center gap-1.5 self-end rounded-control px-2 py-1.5 text-body-s text-ink-2 transition-colors hover:bg-sunk hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7.25 2.5 3.75 6l3.5 3.5" />
      </svg>
      Back to site
    </NextLink>
  );
}
