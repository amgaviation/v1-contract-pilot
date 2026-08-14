import { Box, Card, Container, Text } from "@/components/ui";
import { Logo } from "@/components/ui/logo";

/**
 * Rendered for an unknown token, a revoked one, a draft estimate, or a
 * malformed URL segment — all four, identically. Mirrors
 * app/invoice/[token]/not-found.tsx's own reasoning verbatim: naming which
 * of the four happened would hand a token-probing attacker exactly the
 * signal this page exists to withhold, and the reader is the pilot's
 * client, not a user of this product, so the copy names the one thing they
 * can actually do.
 */
export default function EstimateNotFound() {
  return (
    <Box style={{ minHeight: "100vh", background: "var(--canvas)" }}>
      <Container size="1" p={{ initial: "4", sm: "6" }}>
        <Box mb="5">
          <Logo />
        </Box>
        <Card size="4">
          <Text as="div" size="5" weight="bold" mb="2">
            This link isn&rsquo;t valid
          </Text>
          <Text as="div" color="gray">
            It may have been cut short when it was copied, or your pilot may have sent a
            newer one since. Ask them for a fresh link.
          </Text>
        </Card>
      </Container>
    </Box>
  );
}
