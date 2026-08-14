import { Box, Card, Container, Text } from "@/components/ui";
import { Logo } from "@/components/ui/logo";

/**
 * Rendered for an unknown token, a revoked one, an expired one, and a
 * database error alike — see page.tsx's own comment on why
 * document_packet_public folding all four into zero rows is deliberate.
 * The copy below never says "expired": expires_at IS a real, checkable
 * column (see supabase/migrations/20260810100000_credential_packet_
 * share.sql), but document_packet_public enforces it in the same WHERE
 * clause as revocation and the token match itself, so by the time this
 * page renders there is no way to tell which of the three actually
 * happened — same reasoning as app/invoice/[token]/not-found.tsx, whose
 * copy this mirrors.
 *
 * Colocated here rather than left to fall through to the root
 * app/not-found.tsx: that page's "There's nothing at this address" is
 * accurate but tells a pilot's client nothing useful — it doesn't name
 * what to do next, and it's written for someone who might be poking
 * around the product itself, not a stranger who followed a real link and
 * has no account to sign into.
 *
 * The reader is the pilot's CLIENT, not a user of this product — an
 * operator's scheduler or accounts payable, opening an emailed link.
 */
export default function PacketNotFound() {
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
