"use client";

import NextLink from "next/link";
import { Button, Card, Flex, Text } from "@/components/ui";

/**
 * Root error boundary. An unhandled throw anywhere below the root layout
 * lands here, replacing the group layouts (and their dashboard chrome),
 * so it brings its own theme-only shell rather than the (app) shell,
 * which needs requireAccount() and tenant data that may be exactly what
 * threw. Next.js requires error.tsx to be a Client Component.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Flex align="center" justify="center" minHeight="100vh" p="4">
      <Card size="4" style={{ width: "100%", maxWidth: "30rem" }}>
        <Flex direction="column" align="center" gap="3" style={{ textAlign: "center" }}>
          <Text size="6" weight="bold">
            Something went wrong
          </Text>
          <Text size="2" color="gray">
            That didn&rsquo;t load. Try again, or head back to the overview.
          </Text>
          <Flex gap="3">
            <Button onClick={reset}>Try again</Button>
            <Button asChild variant="outline">
              <NextLink href="/overview">Back to overview</NextLink>
            </Button>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
}
