import NextLink from "next/link";
import { Box, Button, Container, Flex, Text } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { NAVY_SURFACE } from "@/lib/surface-style";

/**
 * The public site's header. Deliberately not the (app) rail's Logo
 * component — that inlines the older black+#036BFC kit
 * (components/ui/logo.tsx), and the owner's brand-mark decision for the
 * signed-out surface is the newer public/brand/*.svg kit (navy.svg here,
 * on this white ground). The two marks are different geometry; using the
 * in-app one on the marketing site would put two different "V1" marks in
 * front of the same visitor within one signup flow.
 *
 * Sticky, like the app's own header after the rebuild (REBUILD-BRIEF
 * §4.4) — solid ground, hairline, no backdrop-filter. The CTA keeps the
 * brand navy rather than the theme accent: on the marketing surface navy
 * is the brand's primary-action color (see lib/surface-style.ts), and it
 * now sits in the same blue family as the app's indigo accent.
 *
 * A plain <img>, not next/image: this is a small, already-optimized SVG
 * with no responsive srcset to gain from the Image component, and asset
 * files under public/ are outside scripts/verify-tokens.mjs's scan
 * entirely, so there is nothing here for that script to check either way.
 */
export default function SiteHeader() {
  return (
    <Box
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        borderBottom: "1px solid var(--gray-a5)",
        background: "var(--color-background)",
      }}
    >
      <Container size="4" px="4">
        <Flex align="center" justify="between" py="3" gap="4" wrap="wrap">
          <NextLink
            href="/"
            aria-label={`${BRAND.name} — ${BRAND.descriptor}`}
            style={{ display: "flex", alignItems: "center" }}
          >
            <img src="/brand/navy.svg" alt="" height={22} width={38} />
          </NextLink>

          <Flex align="center" gap="4" wrap="wrap">
            {/* Anchor into the landing page's outputs section — an
                absolute path so it works from /pricing too. Hidden on the
                narrowest screens so the four header items never push the
                CTA to a second row on a phone. */}
            <Box display={{ initial: "none", xs: "block" }}>
              <Text asChild size="2" color="gray">
                <NextLink href="/#how-it-works">How it works</NextLink>
              </Text>
            </Box>
            <Text asChild size="2" color="gray">
              <NextLink href="/pricing">Pricing</NextLink>
            </Text>
            <Text asChild size="2" color="gray">
              <NextLink href="/login">Log in</NextLink>
            </Text>
            {/* Navy, not the Theme's accent — see the header comment. */}
            <Button asChild size="2" style={NAVY_SURFACE}>
              <NextLink href="/signup">Start free trial</NextLink>
            </Button>
          </Flex>
        </Flex>
      </Container>
    </Box>
  );
}
