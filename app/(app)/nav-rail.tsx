"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Flex, Separator, Text } from "@/components/ui";
import { NAV_SECTIONS, NAV_SETTINGS, isCurrentSection, type NavItem } from "@/lib/nav";

/**
 * The section rail.
 *
 * A client component for exactly one reason — `usePathname`, to mark the
 * current section. Everything else on the authenticated surface stays a
 * server component so pages can query Supabase directly.
 *
 * H9: renders two visual shapes off the SAME `NAV_SECTIONS`/`NAV_SETTINGS`
 * list (never a second, duplicated one) — a vertical rail for `sm` and up,
 * and a horizontally-scrolling strip below it. Both are always in the DOM;
 * app/(app)/layout.tsx toggles which is visible with a CSS `display`
 * breakpoint rather than mounting/unmounting one of them, so navigating
 * between pages never changes which nodes exist and never shifts layout.
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
          borderRadius: "var(--radius-2)",
          background: current ? "var(--accent-a3)" : undefined,
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

/** The same link, laid out for the horizontal strip: no wrap, no shrink. */
function StripLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const current = isCurrentSection(item.href, pathname);
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      style={{ textDecoration: "none", flexShrink: 0 }}
    >
      <Box
        px="3"
        py="2"
        style={{
          borderRadius: "var(--radius-2)",
          background: current ? "var(--accent-a3)" : undefined,
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
}

export function NavRail({ accountName }: { accountName: string }) {
  const pathname = usePathname();

  return (
    <Flex asChild direction="column" gap="1" p="3" height="100%">
      <nav aria-label="Sections">
        {NAV_SECTIONS.map((item) => (
          <RailLink key={item.href} item={item} pathname={pathname} />
        ))}

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
 * way (`aria-current` plus the colour change).
 */
export function NavStrip() {
  const pathname = usePathname();
  const items: NavItem[] = [...NAV_SECTIONS, NAV_SETTINGS];

  return (
    <Flex
      asChild
      gap="1"
      px="3"
      py="2"
      style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}
    >
      <nav aria-label="Sections">
        {items.map((item) => (
          <StripLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
    </Flex>
  );
}
