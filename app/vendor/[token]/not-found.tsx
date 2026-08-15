import { Box, Card, Container, Text } from "@/components/ui";
import { Logo } from "@/components/ui/logo";

/**
 * Rendered for an unknown token, a revoked one, an expired one, a
 * malformed URL segment, and a database error alike — see page.tsx's own
 * comment on why pilot.client_vendor_page_public folding all of those into
 * one outcome is deliberate. The copy below never says "expired", for the
 * same reason app/packet/[token]/not-found.tsx's doesn't: expires_at is a
 * real, checkable column, but it is enforced in the same WHERE clause as
 * revocation and the token match itself, so by the time this page renders
 * there is no way to tell which of the three actually happened.
 *
 * The reader is the pilot's CLIENT — an operator's AP desk or scheduler,
 * opening an emailed link — not a user of this product.
 */
export default function VendorPageNotFound() {
  return (
    <Box style={{ minHeight: "100dvh", background: "var(--canvas)" }}>
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
