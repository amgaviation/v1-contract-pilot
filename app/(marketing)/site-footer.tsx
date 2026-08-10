import NextLink from "next/link";
import { Box, Container, Flex, Separator, Text } from "@/components/ui";
import { BRAND } from "@/lib/brand";

/**
 * The public site's footer — the SECOND of the two places BRAND.attribution
 * is allowed to render (see lib/brand.ts's header comment; the first is
 * app/(app)/layout.tsx's footer). Nowhere else on this route group prints
 * "AMG" — not the header above, not a page body — matching the rule the
 * app layout already follows.
 *
 * The attribution is real rendered text sourced from lib/brand.ts, not
 * baked into an image: public/brand/expanded.svg carries the same words
 * inside its artwork, but an SVG's text isn't selectable or reachable by a
 * screen reader, and the house rule is that this string comes from the
 * constant, not from a picture of the constant. The mark next to it is
 * navy.svg (the bare V1 shape, no wordtext) on this light footer ground —
 * the same file site-header.tsx uses, for the same reason.
 */
export default function SiteFooter() {
  return (
    <Box
      style={{
        borderTop: "1px solid var(--gray-a5)",
        background: "var(--gray-a2)",
      }}
    >
      <Container size="4" px="4">
        <Flex direction="column" gap="4" py="5">
          <Flex
            direction={{ initial: "column", sm: "row" }}
            justify="between"
            align={{ initial: "start", sm: "center" }}
            gap="3"
          >
            <Flex align="center" gap="2">
              <img src="/brand/navy.svg" alt="" height={16} width={28} />
              <Text size="1" color="gray">
                {BRAND.tagline}
              </Text>
            </Flex>

            <Flex gap="4">
              <Text asChild size="1" color="gray">
                <NextLink href="/pricing">Pricing</NextLink>
              </Text>
              <Text asChild size="1" color="gray">
                <NextLink href="/terms">Terms of Service</NextLink>
              </Text>
              <Text asChild size="1" color="gray">
                <NextLink href="/privacy">Privacy Policy</NextLink>
              </Text>
            </Flex>
          </Flex>

          <Separator size="4" />

          <Text size="1" color="gray">
            {BRAND.attribution}
          </Text>
        </Flex>
      </Container>
    </Box>
  );
}
