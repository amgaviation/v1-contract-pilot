"use client";

import * as React from "react";
import NextLink from "next/link";
import { lButtonClass } from "@/components/ledger";
import { BRAND } from "@/lib/brand";

/**
 * The public site's nav — a detached glass pill (.mkt-nav), not an
 * edge-to-edge bar, since the 2026-08-19 marketing reskin. This replaced
 * site-header.tsx and is the surface's ONE client component besides the
 * reveal primitive; everything below the fold stays server-rendered.
 *
 * WHY A CLIENT COMPONENT AT ALL: the old header simply hid "How it
 * works" below `sm` and "Your data" below `md`, which meant a phone
 * visitor could not reach two of the site's four pages from its own
 * navigation. The phone menu fixes that properly — every link, full
 * screen, with the burger morphing to an X and the items staggering in
 * (.mkt-menu / .mkt-burger in app/design/marketing.css; reduced motion
 * drops all of it there too).
 *
 * The mark stays public/brand/white.svg — same kit, same geometry as the
 * old header, for the same two-marks-one-flow reason its comment carried.
 *
 * Body scroll locks while the menu is open via an effect assigning
 * document.body.style.overflow — imperative on purpose: an inline JSX
 * style literal is the pattern tokens:verify polices, and a cleanup
 * function is what guarantees the lock never outlives the menu.
 */

const LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/your-data", label: "Your data" },
] as const;

export default function SiteNav() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 px-4 pt-4">
        <div className="mkt-nav mx-auto flex w-full max-w-3xl items-center justify-between gap-4 py-2 pl-5 pr-2">
          <NextLink
            href="/"
            aria-label={BRAND.name}
            onClick={() => setOpen(false)}
            className="flex items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <img src="/brand/white.svg" alt="" height={18} width={31} />
          </NextLink>

          <nav aria-label="Primary" className="hidden items-center gap-5 md:flex">
            {LINKS.map((link) => (
              <NextLink
                key={link.href}
                href={link.href}
                className="text-body-s text-ink-2 transition-colors hover:text-ink"
              >
                {link.label}
              </NextLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <NextLink
              href="/login"
              className="hidden text-body-s text-ink-2 transition-colors hover:text-ink sm:inline"
            >
              Log in
            </NextLink>
            <NextLink
              href="/signup"
              className={lButtonClass({
                size: "sm",
                variant: "onBrand",
                className: "rounded-full",
              })}
            >
              Get started
            </NextLink>
            <button
              type="button"
              aria-expanded={open}
              aria-controls="mkt-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink md:hidden"
            >
              <span className="mkt-burger" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* The phone menu. Stays mounted so the glass sheet and the item
          stagger can transition; [data-open] is the switch. aria-hidden
          plus inert-by-visibility keeps it out of the tab order closed
          (visibility: hidden removes it from the a11y tree and from
          focus, which is what the delayed transition in .mkt-menu
          preserves through the exit). */}
      <div
        id="mkt-menu"
        className="mkt-menu md:hidden"
        data-open={open}
        aria-hidden={!open}
      >
        <nav
          aria-label="Menu"
          className="flex h-full flex-col justify-center gap-2 px-8"
        >
          {LINKS.map((link) => (
            <NextLink
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="mkt-menu-item font-display text-display-s font-bold text-ink"
            >
              {link.label}
            </NextLink>
          ))}
          <NextLink
            href="/login"
            onClick={() => setOpen(false)}
            className="mkt-menu-item font-display text-display-s font-bold text-ink"
          >
            Log in
          </NextLink>
          <NextLink
            href="/signup"
            onClick={() => setOpen(false)}
            className={lButtonClass({
              size: "lg",
              variant: "onBrand",
              className: "mkt-menu-item mt-6 w-max rounded-full",
            })}
          >
            Get started
          </NextLink>
        </nav>
      </div>
    </>
  );
}
