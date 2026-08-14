"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Flex, Separator, Text } from "@/components/ui";
import {
  NAV_SETTINGS,
  isCurrentSection,
  navGroupsAreContiguous,
  type NavItem,
} from "@/lib/nav";

/**
 * The section rail — the product's one dark surface. The dark ground
 * itself is painted by the `data-appearance="dark"` Box app-shell.tsx
 * wraps this component in; everything in this file resolves against the
 * dark palette automatically (gray/default Text, --signal-soft fills,
 * hairlines) because tokens are the only values used — see
 * app/design/tokens.css §8 for the mechanism (a plain attribute selector,
 * not a component).
 *
 * A client component for exactly one reason — `usePathname`, to mark the
 * current section. Everything else on the authenticated surface stays a
 * server component so pages can query Supabase directly. That split is
 * also why `sections` arrives as a PROP rather than being imported here:
 * the list is filtered by the server-only currency flag
 * (lib/nav.ts visibleNavSections + lib/currency/gate.ts), which a client
 * component cannot read. Both shapes below render off the SAME passed
 * list plus NAV_SETTINGS — never a second, duplicated one.
 *
 * H9: renders two visual shapes — a vertical rail for `sm` and up, and a
 * horizontally-scrolling strip below it. Both are always in the DOM;
 * app-shell.tsx toggles which is visible with a CSS `display` breakpoint
 * rather than mounting/unmounting one of them, so navigating between
 * pages never changes which nodes exist and never shifts layout.
 *
 * Rail links carry a CONSTANT 2px left border (transparent when idle,
 * --signal when current) so activation never shifts layout — the one
 * restrained instrument gesture on the dark ground: a course-bar edge,
 * not a glow. The strip omits the left border (it reads wrong on a
 * horizontal strip) and uses the fill + highContrast alone.
 */
function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const current = isCurrentSection(item.href, pathname);
  return (
    <Link
      href={item.href}
      // aria-current is what actually announces the section to a screen
      // reader; the colour change below is the sighted half of the same
      // statement, not a substitute for it.
      aria-current={current ? "page" : undefined}
      style={{ textDecoration: "none" }}
    >
      <Box
        px="3"
        py="2"
        style={{
          borderRadius: "var(--radius)",
          borderLeft: current
            ? "2px solid var(--signal)"
            : "2px solid transparent",
          background: current ? "var(--signal-soft)" : undefined,
        }}
      >
        <Text
          size="2"
          weight={current ? "medium" : "regular"}
          color={current ? undefined : "gray"}
          highContrast={current}
        >
          {item.label}
        </Text>
      </Box>
    </Link>
  );
}

/** The same link, laid out for the horizontal strip: no wrap, no shrink,
 *  no left border (fill + highContrast mark the current section). */
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
      style={{
        textDecoration: "none",
        flexShrink: 0,
        // Pairs with scrollSnapType on the strip below.
        scrollSnapAlign: "center",
      }}
    >
      <Box
        px="3"
        py="2"
        style={{
          borderRadius: "var(--radius)",
          background: current ? "var(--signal-soft)" : undefined,
          whiteSpace: "nowrap",
        }}
      >
        <Text
          size="2"
          weight={current ? "medium" : "regular"}
          color={current ? undefined : "gray"}
          highContrast={current}
        >
          {item.label}
        </Text>
      </Box>
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
    <Flex asChild direction="column" gap="1" p="3" height="100%">
      <nav aria-label="Sections">
        {sections.map((item, index) => {
          // A group header renders wherever the group changes walking the
          // list in order — lib/nav.ts writes the list in group order for
          // exactly this check. Plain uppercase size-1 gray text, no
          // letter-spacing (a literal would be a token violation; the cap
          // label is enough).
          const previous = index > 0 ? sections[index - 1] : undefined;
          const showHeader =
            grouped && item.group !== undefined && item.group !== previous?.group;
          return (
            <Box key={item.href}>
              {showHeader ? (
                <Box px="3" mb="1" mt={index > 0 ? "4" : undefined}>
                  <Text size="1" color="gray" weight="medium">
                    {item.group}
                  </Text>
                </Box>
              ) : null}
              <RailLink item={item} pathname={pathname} />
            </Box>
          );
        })}

        <Box my="2">
          <Separator size="4" />
        </Box>

        <RailLink item={NAV_SETTINGS} pathname={pathname} />

        {/* The account this session is acting for. Pinned to the bottom
            because it answers "whose data am I looking at" — a question
            you ask when something looks wrong, not while navigating. */}
        <Box mt="auto" pt="4" px="3">
          <Text as="div" size="1" color="gray">
            Signed in to
          </Text>
          <Text as="div" size="2" weight="medium" trim="end">
            {accountName}
          </Text>
        </Box>
      </nav>
    </Flex>
  );
}

/**
 * The compact, phone-width equivalent: a horizontally scrolling strip of
 * the same sections plus Settings, all always reachable by scrolling or
 * by Tab (nothing here is clipped with `overflow: hidden`, only
 * `overflow-x: auto`), with the current section still announced the same
 * way (`aria-current` plus the colour change). Group headers are a rail
 * treatment only — on a horizontal strip they would read as items.
 */
export function NavStrip({ sections }: { sections: readonly NavItem[] }) {
  const pathname = usePathname();
  const items: NavItem[] = [...sections, NAV_SETTINGS];
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
  // Costs nothing on desktop: from `md` up the strip's container is
  // display:none, and scrollIntoView on a display:none element is a
  // no-op in every engine.
  React.useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <Flex
      asChild
      gap="1"
      px="3"
      py="2"
      style={{
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        // Keeps a swipe that reaches either end of the strip from
        // chaining out to the document — and, on iOS, from triggering the
        // browser's back-swipe gesture.
        overscrollBehaviorInline: "contain",
      }}
    >
      <nav aria-label="Sections">
        {items.map((item) => (
          <StripLink
            key={item.href}
            item={item}
            pathname={pathname}
            ref={isCurrentSection(item.href, pathname) ? currentRef : undefined}
          />
        ))}
      </nav>
    </Flex>
  );
}
