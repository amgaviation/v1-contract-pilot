"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Flex, Separator, Text } from "@radix-ui/themes";
import { NAV_SECTIONS, NAV_SETTINGS, isCurrentSection, type NavItem } from "@/lib/nav";

/**
 * The section rail.
 *
 * A client component for exactly one reason — `usePathname`, to mark the
 * current section. Everything else on the authenticated surface stays a
 * server component so pages can query Supabase directly.
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

export default function NavRail({ accountName }: { accountName: string }) {
  const pathname = usePathname();

  return (
    <Flex direction="column" gap="1" p="3" height="100%">
      {NAV_SECTIONS.map((item) => (
        <RailLink key={item.href} item={item} pathname={pathname} />
      ))}

      <Box my="2">
        <Separator size="4" />
      </Box>

      <RailLink item={NAV_SETTINGS} pathname={pathname} />

      {/* The account this session is acting for. Pinned to the bottom
          because it answers "whose data am I looking at" — a question you
          ask when something looks wrong, not while navigating. */}
      <Box mt="auto" pt="4" px="3">
        <Text as="div" size="1" color="gray">
          Signed in to
        </Text>
        <Text as="div" size="2" weight="medium" trim="end">
          {accountName}
        </Text>
      </Box>
    </Flex>
  );
}
