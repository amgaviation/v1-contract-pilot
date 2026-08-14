import { Box, Flex, Text } from "@/components/ui";
import { BRAND } from "@/lib/brand";

/**
 * The post-checkout onboarding surface. Its OWN route group, deliberately
 * outside (app): the (app) layout redirects a provisioned-but-not-onboarded
 * account to /onboarding, so the wizard must not itself live under that gate
 * or the redirect would loop. No dashboard rail — the pilot has nothing to
 * navigate to yet. The page does its own session check (requireAccount with
 * allowUnonboarded).
 *
 * Not centered like (auth): the wizard is taller than a login card, so it
 * scrolls from the top on a short viewport instead of clipping a vertically
 * centered panel.
 *
 * The slim header is the one piece of chrome, added in the 2026-08 pass so
 * this screen is recognisably the same product the pilot just paid for
 * rather than a bare form on a gray field. It carries the mark and nothing
 * clickable: there is deliberately nowhere to go from here except through
 * the wizard or past it ("Skip for now").
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Box
      // .v1-nozoom-fields: the wizard's eighteen fields take the size="2"
      // default (12.6px at 90% scaling), well under the 16px below which iOS
      // Safari zooms on focus. See app/globals.css.
      className="v1-nozoom-fields"
      style={{ minHeight: "100vh", background: "var(--canvas)" }}
    >
      <Box
        style={{
          borderBottom: "1px solid var(--hair)",
          background: "var(--paper)",
        }}
      >
        {/* ONE MEASURE, DECLARED ONCE. This was Container size="2" — 688px,
            minus px="4" each side — sitting above a 704px content box, so
            the mark rendered 22.4px inboard of the left edge of the card
            directly beneath it and the caption stopped 22.4px short on the
            right. Header and body now share the identical wrapper, so the
            two cannot drift apart again. */}
        <Box px="4">
          <Box mx="auto" style={{ width: "100%", maxWidth: "44rem" }}>
            <Flex align="center" gap="3" py="3">
              <img src="/brand/navy.svg" alt="" height={20} width={34} />
              <Text size="1" color="gray">
                {BRAND.descriptor} · Account setup
              </Text>
            </Flex>
          </Box>
        </Box>
      </Box>

      <Box px="4" pb="8">
        <Box mx="auto" py="6" style={{ width: "100%", maxWidth: "44rem" }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
