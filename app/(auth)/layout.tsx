import NextLink from "next/link";
import { Box, Flex, Grid, Text } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { NAVY_INK, NAVY_INK_MUTED } from "@/lib/surface-style";

/**
 * THE SIGNED-OUT SURFACE — /signup, /login, /forgot-password,
 * /reset-password, /welcome. Each page still does its own session check;
 * this file is composition only.
 *
 * It used to be a single centered Flex, so every screen was one small card
 * floating on white — the shape a database admin tool ships with, on the
 * surface where this product asks for a card number. It is now a split: the
 * brand's navy panel on the left, carrying the mark, the tagline and one
 * line of reassurance, and the form on the light ground beside it.
 *
 * THE NAVY IS THE SAME NAVY. .v1-m-dark is the class the landing page's
 * hero and CTA band use (app/globals.css), reached through the same
 * lib/surface-style.ts ink constants — so a visitor who clicks "Start the
 * trial" on the front door does not change design systems mid-flow, which
 * is exactly what happened before.
 *
 * On a phone the panel collapses to a slim band carrying only the mark: the
 * reassurance copy is the part that gives way, never the form.
 *
 * The mark is public/brand/white.svg — the same brand kit the public header
 * uses (navy.svg on a light ground, white.svg on this dark one), NOT
 * components/ui/logo.tsx, which inlines the older in-app kit. Two different
 * marks inside one signup flow is what that rule exists to prevent. A plain
 * <img> for the reason site-header.tsx gives: a small, already-optimized
 * SVG has no srcset to gain from next/image.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Grid
      // .v1-nozoom-fields: on a touch device every field inside renders at a
      // real 16px so iOS Safari does not zoom the page on focus. See the rule
      // in app/globals.css for why the number is literal.
      className="v1-nozoom-fields"
      columns={{ initial: "1", md: "2fr 3fr" }}
      // On a phone the panel is a band sized to the mark and the form
      // takes the rest of the viewport; side by side, both fill it.
      rows={{ initial: "auto 1fr", md: "1fr" }}
      minHeight="100dvh"
    >
      <Box className="v1-m-dark" p={{ initial: "4", md: "8" }}>
        <Flex direction="column" justify="between" gap="8" height="100%">
          <NextLink
            href="/"
            aria-label={`${BRAND.name}, ${BRAND.descriptor}`}
            style={{ display: "flex", alignItems: "center" }}
          >
            <img src="/brand/white.svg" alt="" height={24} width={41} />
          </NextLink>

          {/* BRAND FURNITURE, NOT A DOCUMENT HEADING. Radix's Heading
              defaults to as="h1", so this rendered a second <h1> that
              PRECEDED each screen's real one in DOM order — and only above
              md, so /signup announced a different heading structure on a
              laptop than on a phone. It is also the rule docs/MARKETING.md
              §4 writes down: BRAND.tagline is not the H1. The size is kept;
              only the element changes. */}
          <Box display={{ initial: "none", md: "block" }}>
            <Text as="p" size="7" weight="bold" trim="start" style={NAVY_INK}>
              {BRAND.tagline}
            </Text>
            <Text as="p" size="3" mt="3" style={NAVY_INK_MUTED}>
              The invoice lines and the logbook draft come off that one
              record, and the receipts are filed against it.
            </Text>
          </Box>

          {/* One line, and it is the promise a professional actually wants
              before typing a password: the records leave with them. True on
              every tier — account_export is minTier "solo" in
              lib/entitlements.ts, deliberately. */}
          <Box display={{ initial: "none", md: "block" }}>
            <Text size="1" style={NAVY_INK_MUTED}>
              Your records export on every plan, from the day you put them in.
            </Text>
          </Box>
        </Flex>
      </Box>

      <Flex align="center" justify="center" p={{ initial: "5", md: "8" }}>
        <Box width="100%" style={{ maxWidth: "28rem" }}>
          {children}
        </Box>
      </Flex>
    </Grid>
  );
}
