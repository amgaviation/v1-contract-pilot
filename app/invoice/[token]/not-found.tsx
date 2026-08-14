import { Box, Card, Container, Text } from "@/components/ui";
import { Logo } from "@/components/ui/logo";

/**
 * Rendered for an unknown token, a revoked one, a draft/void invoice, or a
 * malformed URL segment — all four, identically. This is deliberate: see
 * page.tsx's own comment. The copy below says nothing about WHICH of
 * those happened, on purpose — that distinction is exactly what an
 * attacker probing for valid tokens would use as a signal, and this page
 * is not the place to hand it to them. It also never says "expired":
 * pilot.invoice_public's null result folds an unknown token, a revoked
 * one and an invoice that reverted out of a shareable status into the
 * same outcome this page renders for, so there is no case this page can
 * actually distinguish as expiry rather than one of the other two.
 *
 * The reader is the pilot's CLIENT, not a user of this product — an
 * operator's scheduler or accounts payable, opening an emailed link.
 * They don't have an account here and never will, so the copy names the
 * one thing they CAN do (ask the pilot who sent it) rather than a
 * generic "contact support".
 */
export default function InvoiceNotFound() {
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
