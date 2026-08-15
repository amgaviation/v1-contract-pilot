"use client";

import NextLink from "next/link";
import { Button, Card, Flex, Text } from "@/components/ui";
import { DASHBOARD_PATH } from "@/lib/nav";

/**
 * Group-level error boundary for the authenticated surface. Without this
 * file, a throw anywhere under /overview, /invoices, /trips, etc. was
 * caught by the ROOT boundary (app/error.tsx), which replaces everything
 * down to the html body — the dark nav rail and the rest of the (app)
 * shell vanished along with whatever page actually failed, and "try
 * again" from there meant re-navigating from a blank screen, not
 * recovering in place.
 *
 * This one renders INSIDE app/(app)/layout.tsx, in the page slot AppShell
 * already lays out — so it only replaces the one broken page, and the
 * rail stays clickable. That is also why it is safe to keep this boundary
 * this thin: the root boundary is the one that has to assume
 * requireAccount() or a tenant read is what threw, so it cannot lean on
 * any app chrome or nav data existing. By the time a throw reaches here,
 * this layout's own requireAccount() already succeeded — the shell is
 * already on screen — so recovery only has to get the page's own content
 * to render again, which is what reset() is for.
 */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card size="3">
      <Flex direction="column" gap="3">
        <Text size="5" weight="bold">
          Something went wrong
        </Text>
        <Text size="2" color="gray">
          That didn&rsquo;t load. Try again, or head back to the overview.
        </Text>
        <Flex gap="3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <NextLink href={DASHBOARD_PATH}>Back to overview</NextLink>
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
}
