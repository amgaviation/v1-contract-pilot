import { Box } from "@/components/ui";

/**
 * The post-checkout onboarding surface. Its OWN route group, deliberately
 * outside (app): the (app) layout redirects a provisioned-but-not-onboarded
 * account to /onboarding, so the wizard must not itself live under that gate
 * or the redirect would loop. Theme-only chrome, no dashboard rail — the
 * pilot has nothing to navigate to yet. The page does its own session check
 * (requireAccount with allowUnonboarded).
 *
 * Not centered like (auth): the wizard is taller than a login card, so it
 * scrolls from the top on a short viewport instead of clipping a vertically
 * centered panel.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Box
      p="4"
      style={{ minHeight: "100vh", background: "var(--gray-2)" }}
    >
      <Box mx="auto" py="6" style={{ width: "100%", maxWidth: "40rem" }}>
        {children}
      </Box>
    </Box>
  );
}
