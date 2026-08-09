import { Box, Card, Container, Text } from "@/components/ui";
import { Logo } from "@/components/ui/logo";

/**
 * Rendered for an unknown token, a revoked one, a draft/void invoice, or a
 * malformed URL segment — all four, identically. This is deliberate: see
 * page.tsx's own comment. The copy below says nothing about WHICH of
 * those happened, on purpose — that distinction is exactly what an
 * attacker probing for valid tokens would use as a signal, and this page
 * is not the place to hand it to them.
 */
export default function InvoiceNotFound() {
  return (
    <Box style={{ minHeight: "100vh", background: "var(--gray-2)" }}>
      <Container size="1" p={{ initial: "4", sm: "6" }}>
        <Box mb="5">
          <Logo />
        </Box>
        <Card size="4">
          <Text as="div" size="5" weight="bold" mb="2">
            This link isn&rsquo;t available
          </Text>
          <Text as="div" color="gray">
            It may have been revoked, or the invoice may no longer be shared. Contact whoever
            sent you this link for a current one.
          </Text>
        </Card>
      </Container>
    </Box>
  );
}
