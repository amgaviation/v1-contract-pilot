import NextLink from "next/link";
import { Box, Container, Flex, Grid, Separator, Text } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { GRAY_BAND } from "@/lib/surface-style";

/**
 * The public site's footer — the SECOND of the two places BRAND.attribution
 * is allowed to render (see lib/brand.ts's header comment; the first is
 * app/(app)/layout.tsx's footer). Nowhere else on this route group prints
 * "AMG" — not the header above, not a page body — matching the rule the
 * app layout already follows.
 *
 * The ground is the same gray-2 band token the section rhythm uses
 * (lib/surface-style.ts GRAY_BAND), so the footer closes the page as one
 * more band of the canvas system rather than its own third gray.
 *
 * The attribution is real rendered text sourced from lib/brand.ts, not
 * baked into an image: public/brand/expanded.svg carries the same words
 * inside its artwork, but an SVG's text isn't selectable or reachable by a
 * screen reader, and the house rule is that this string comes from the
 * constant, not from a picture of the constant. The mark next to it is
 * navy.svg (the bare V1 shape, no wordtext) on this light footer ground —
 * the same file site-header.tsx uses, for the same reason.
 */
const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/login", label: "Log in" },
      { href: "/signup", label: "Start free trial" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
    ],
  },
];

export default function SiteFooter() {
  return (
    // asChild -> <footer>: the public surface's landmarks stop at <main>
    // without this (and site-header.tsx's matching <header>) — the
    // authenticated shell already uses header/nav/main/aside landmarks
    // throughout, and this is the screen a screen-reader user meets first.
    <Box
      asChild
      style={{
        borderTop: "1px solid var(--edge)",
        ...GRAY_BAND,
      }}
    >
      <footer>
        <Container size="4" px="4">
          <Flex direction="column" gap="5" py="6">
            {/* asChild -> <nav aria-label>: these are the footer's actual
                navigation links, distinct from the brand/tagline column
                beside them, which is not. */}
            <Grid asChild columns={{ initial: "1", sm: "4" }} gap="5">
              <nav aria-label="Footer">
                <Flex direction="column" gap="2" align="start">
                  <img src="/brand/navy.svg" alt="" height={16} width={28} />
                  <Text size="1" color="gray">
                    {BRAND.tagline}
                  </Text>
                </Flex>

                {COLUMNS.map((column) => (
                  <Flex key={column.heading} direction="column" gap="2">
                    <Text size="1" weight="medium" color="gray">
                      {column.heading.toUpperCase()}
                    </Text>
                    {column.links.map((link) => (
                      <Text asChild key={link.href} size="1" color="gray">
                        <NextLink href={link.href}>{link.label}</NextLink>
                      </Text>
                    ))}
                  </Flex>
                ))}
              </nav>
            </Grid>

            <Separator size="4" />

            <Text size="1" color="gray">
              {BRAND.attribution}
            </Text>
          </Flex>
        </Container>
      </footer>
    </Box>
  );
}
