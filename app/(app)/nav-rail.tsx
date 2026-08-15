"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ledger/cn";
import {
  NAV_SETTINGS,
  NAV_HELP,
  isCurrentSection,
  navGroupsAreContiguous,
  type NavItem,
} from "@/lib/nav";

/**
 * THE SECTION RAIL — restyled to Ledger (docs/design/LEDGER.md, Phase 2).
 *
 * It is no longer the product's one dark surface: INSTRUMENT's rail carried
 * a permanent `data-appearance="dark"` wrapper so it read as a distinct
 * instrument panel regardless of the tenant's own light/dark choice. Ledger
 * is the fintech register, and the register's rail is a LIGHT structural
 * surface in day mode — `bg-sunk` (one step off the canvas, the same
 * structural-vs-floating distinction app-shell.tsx's header comment draws)
 * with a right hairline, current section marked by a filled pill rather
 * than a glow. At night it simply follows the tenant's own
 * `data-appearance="dark"` — stamped once, on the shell root, by
 * app-shell.tsx — same as every other Ledger surface; there is no longer a
 * second, forced-dark palette nested inside it.
 *
 * A client component for exactly one reason — `usePathname`, to mark the
 * current section. Everything else on the authenticated surface stays a
 * server component so pages can query Supabase directly. That split is
 * also why `sections` arrives as a PROP rather than being imported here:
 * the list is filtered by the server-only currency flag
 * (lib/nav.ts visibleNavSections + lib/currency/gate.ts), which a client
 * component cannot read. Both shapes below render off the SAME passed
 * list plus NAV_SETTINGS and NAV_HELP — never a second, duplicated one.
 *
 * H9: renders two visual shapes — a vertical rail from `lg` up, and a
 * horizontally-scrolling strip below it. Both are always in the DOM;
 * app-shell.tsx toggles which is visible with `hidden`/`lg:hidden`
 * (Tailwind's `display` breakpoint utilities) rather than mounting/
 * unmounting one of them, so navigating between pages never changes which
 * nodes exist and never shifts layout. `lg` is deliberately the switch,
 * not `md`: Tailwind's `lg` is a literal `min-width: 1024px`, the same
 * number app-shell.tsx's own breakpoint comment pins the shell to (that
 * comment's rationale — the crushed 768–1023px band that iPad portrait and
 * 150–175% desktop browser zoom both land in — is unchanged by the move to
 * Tailwind's naming, only which utility spells "1024" moved).
 *
 * Rail links carry a CONSTANT 2px left border (`border-l-2`, transparent
 * when idle, `border-accent` when current) so activation never shifts
 * layout — a course-bar edge, not a glow, same restrained gesture the
 * dark rail used, translated to Ledger's accent. The strip omits the left
 * border (it reads wrong on a horizontal strip) and uses the
 * `bg-accent-soft` + `text-accent` fill alone, same as the current-section
 * treatment `components/ledger`'s LPill already establishes for "accent"
 * tone elsewhere in the product.
 */

/** Shared by both link shapes: a visible keyboard-focus ring in the
 *  register's own accent, since neither shape had an explicit one before
 *  (both relied on the browser default, invisible against a dark ground). */
const LINK_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const current = isCurrentSection(item.href, pathname);
  return (
    <Link
      href={item.href}
      // aria-current is what actually announces the section to a screen
      // reader; the colour change below is the sighted half of the same
      // statement, not a substitute for it.
      aria-current={current ? "page" : undefined}
      className={cn(
        "block rounded-control border-l-2 px-3 py-2 no-underline",
        current
          ? "border-accent bg-accent-soft"
          : "border-transparent hover:bg-sunk",
        LINK_FOCUS
      )}
    >
      <span
        className={cn(
          "text-body-s",
          current ? "font-medium text-accent" : "text-ink-2"
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}

/** The same link, laid out for the horizontal strip: no wrap, no shrink,
 *  no left border (the fill + weight change mark the current section),
 *  and `snap-center` to pair with `snap-x`/`snap-proximity` on the strip
 *  below — the strip now actually declares the scroll-snap TYPE that
 *  pairs with this ALIGN, which the INSTRUMENT version's own comment
 *  promised but never wired up on the container. */
const StripLink = React.forwardRef<
  HTMLAnchorElement,
  { item: NavItem; pathname: string }
>(function StripLink({ item, pathname }, ref) {
  const current = isCurrentSection(item.href, pathname);
  return (
    <Link
      ref={ref}
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "block shrink-0 snap-center whitespace-nowrap rounded-control px-3 py-2 no-underline",
        current ? "bg-accent-soft" : "hover:bg-sunk",
        LINK_FOCUS
      )}
    >
      <span
        className={cn(
          "text-body-s",
          current ? "font-medium text-accent" : "text-ink-2"
        )}
      >
        {item.label}
      </span>
    </Link>
  );
});

export function NavRail({
  accountName,
  sections,
}: {
  accountName: string;
  sections: readonly NavItem[];
}) {
  const pathname = usePathname();

  // Headers only while they still mean something. A tenant nav layout can
  // interleave two groups, and "render a header wherever the group
  // changes" then prints BUSINESS twice with a four-step gap mid-list —
  // headers that group nothing. navGroupsAreContiguous (lib/nav.ts) is
  // the predicate; when it fails the rail renders FLAT, which is the
  // arrangement the pilot actually asked for. Hiding sections, reordering
  // inside a group, or promoting a whole group all keep their headers.
  const grouped = navGroupsAreContiguous(sections);

  return (
    // flex-1, not h-full: the rail's account block is pinned to the
    // bottom of the AVAILABLE space below the logo block app-shell.tsx
    // renders above this nav, and only flex-grow (not a height percentage)
    // reliably claims that remaining space in a column flex parent — see
    // app-shell.tsx's own aside for the sticky/scrolling ancestor this
    // nav fills.
    <nav aria-label="Sections" className="flex flex-1 flex-col gap-1 p-3">
      {sections.map((item, index) => {
        // A group header renders wherever the group changes walking the
        // list in order — lib/nav.ts writes the list in group order for
        // exactly this check.
        const previous = index > 0 ? sections[index - 1] : undefined;
        const showHeader =
          grouped && item.group !== undefined && item.group !== previous?.group;
        return (
          <div key={item.href}>
            {showHeader ? (
              <div className={cn("mb-1 px-3", index > 0 && "mt-4")}>
                <span className="text-caption font-semibold text-ink-3">
                  {item.group}
                </span>
              </div>
            ) : null}
            <RailLink item={item} pathname={pathname} />
          </div>
        );
      })}

      <hr className="my-2 border-0 border-t border-hair" />

      <RailLink item={NAV_SETTINGS} pathname={pathname} />
      <RailLink item={NAV_HELP} pathname={pathname} />

      {/* The account this session is acting for. Pinned to the bottom
          because it answers "whose data am I looking at" — a question
          you ask when something looks wrong, not while navigating. */}
      <div className="mt-auto px-3 pt-4">
        <div className="text-caption text-ink-3">Signed in to</div>
        <div className="truncate text-body-s font-medium text-ink">
          {accountName}
        </div>
      </div>
    </nav>
  );
}

/**
 * The compact, phone-width equivalent: a horizontally scrolling strip of
 * the same sections plus Settings, all always reachable by scrolling or
 * by Tab (nothing here is clipped with `overflow-hidden`, only
 * `overflow-x-auto`), with the current section still announced the same
 * way (`aria-current` plus the colour change). Group headers are a rail
 * treatment only — on a horizontal strip they would read as items.
 */
export function NavStrip({ sections }: { sections: readonly NavItem[] }) {
  const pathname = usePathname();
  const items: NavItem[] = [...sections, NAV_SETTINGS, NAV_HELP];
  const currentRef = React.useRef<HTMLAnchorElement | null>(null);

  // SCROLL THE CURRENT SECTION INTO VIEW.
  //
  // The strip holds twelve entries and a phone shows about four. Without
  // this, a pilot on Reports — the eleventh — saw a strip reading
  // "Overview Trips Logbook Estimates": none of them the page they were
  // on, no indication that the strip scrolled at all, and no indication
  // they were looking at the wrong end of it. The rail never had this
  // problem because it shows every section at once; the strip is the
  // shape that needs the help.
  //
  // `inline: "center"` rather than "nearest" on purpose — centring
  // reveals the neighbours on BOTH sides, which is the thing that tells
  // you the strip scrolls. `block: "nearest"` stops it scrolling the
  // PAGE vertically to achieve that.
  //
  // Costs nothing on desktop: from `lg` up the strip's container is
  // `hidden`, and scrollIntoView on a display:none element is a no-op in
  // every engine.
  React.useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav
      aria-label="Sections"
      // snap-x + snap-proximity is the scroll-snap TYPE; each StripLink's
      // own snap-center is the ALIGN. "Proximity" rather than "mandatory"
      // deliberately — a nudge toward the nearest item when a scroll ends
      // near one, not a hard lock that fights a pilot mid-swipe.
      // overscroll-x-contain keeps a swipe that reaches either end of the
      // strip from chaining out to the document — and, on iOS, from
      // triggering the browser's back-swipe gesture.
      className="flex snap-x snap-proximity gap-1 overflow-x-auto overscroll-x-contain px-3 py-2"
    >
      {items.map((item) => (
        <StripLink
          key={item.href}
          item={item}
          pathname={pathname}
          ref={isCurrentSection(item.href, pathname) ? currentRef : undefined}
        />
      ))}
    </nav>
  );
}
