import type { ReactNode } from "react";
import { Flex, Heading, Text } from "@/components/ui";

/**
 * The standard heading block for a feature page: a title, optional
 * subtitle, and an action slot that sits alongside on wide screens and
 * stacks beneath on narrow ones.
 *
 * Deliberately thinner than the shell it replaces. That one also owned the
 * page's navbar, padding and footer, which meant every screen inherited
 * chrome it could not opt out of. Those now live in the route group's
 * layout, where they belong, and this is just the header — so a page that
 * wants a different heading treatment simply doesn't use it.
 *
 * A server component composing server components, so pages built on it
 * stay server components and query Supabase directly.
 */
export default function PageShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    // gap "5", not "4": panels on the gray-2 canvas need one more step of
    // air under the title block than flat regions did (2026-08 rebuild,
    // docs/design/REBUILD-BRIEF.md §4.5). No border under the title —
    // the canvas/panel contrast does that job now.
    <Flex direction="column" gap="5">
      <Flex
        direction={{ initial: "column", sm: "row" }}
        justify="between"
        align={{ initial: "start", sm: "center" }}
        gap="3"
      >
        <Flex direction="column" gap="1">
          <Heading size="6" trim="start">
            {title}
          </Heading>
          {subtitle ? (
            <Text size="2" color="gray">
              {subtitle}
            </Text>
          ) : null}
        </Flex>
        {action ? (
          <Flex gap="2" flexShrink="0">
            {action}
          </Flex>
        ) : null}
      </Flex>
      {children}
    </Flex>
  );
}
