import NextLink from "next/link";
import { Button, Card, Flex, Text } from "@/components/ui";

/**
 * Root 404 — reached for any unmatched path, signed in or out. It renders
 * outside the (app) dashboard chrome, so it brings its own theme-only
 * shell rather than the (app) shell, which needs requireAccount() and a
 * resolved route this page doesn't have.
 *
 * The gray-2 ground is the app's canvas token (2026-08 rebuild): the Card
 * below is a surface panel by default now, and it needs the canvas behind
 * it to read as one, not as a stray outline on a bare page.
 */
export default function NotFound() {
  return (
    <Flex
      align="center"
      justify="center"
      minHeight="100dvh"
      p="4"
      style={{ background: "var(--canvas)" }}
    >
      <Card size="4" style={{ width: "100%", maxWidth: "30rem" }}>
        <Flex direction="column" align="center" gap="3" style={{ textAlign: "center" }}>
          <Text size="6" weight="bold">
            Not found
          </Text>
          <Text size="2" color="gray">
            There&rsquo;s nothing at this address.
          </Text>
          <Button asChild>
            <NextLink href="/">Back home</NextLink>
          </Button>
        </Flex>
      </Card>
    </Flex>
  );
}
