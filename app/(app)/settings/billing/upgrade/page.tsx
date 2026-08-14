import NextLink from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Flex, Text } from "@/components/ui";
import { requireAccount } from "@/lib/supabase/account";
import {
  FEATURES,
  TIER_DISPLAY,
  featuresAddedByTier,
  isEntitled,
  isFeatureId,
} from "@/lib/entitlements";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";
import { safeNextPath } from "@/lib/safe-next";
import { DASHBOARD_PATH } from "@/lib/nav";
import PageShell from "../../../page-shell";
import { visibleDowngradeNote } from "../downgrade-note";

export const metadata = { title: "Upgrade" };

/**
 * Where requireEntitlement (lib/supabase/entitlements.ts) sends an
 * over-tier visit. NEVER a 404 and never an error state: landing here is
 * an ordinary, expected event — a downgraded account revisiting a Pro
 * screen, a shared link, a bookmark — and the job is to say what the
 * feature is, that nothing was deleted, and how to turn it back on.
 *
 * This page lives under /settings/billing so it can never itself be
 * gated, and it is reachable by every role (a bookkeeper hitting a gated
 * screen sees the explanation too — only the CHANGE buttons on the
 * billing screen are owner-only).
 */
export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string; from?: string }>;
}) {
  const { feature: rawFeature, from } = await searchParams;
  const { account } = await requireAccount("/settings/billing/upgrade");

  const feature = isFeatureId(rawFeature) ? rawFeature : null;

  // Entitled after all (they upgraded, then re-followed the redirect, or
  // the link was stale): straight back to the screen they wanted.
  // safeNextPath keeps the bounce on-origin.
  if (feature && isEntitled(account.plan_tier, feature)) {
    redirect(from ? safeNextPath(from) : "/settings/billing");
  }

  const requiredTier = feature ? FEATURES[feature].minTier : "pro";
  const tierName = TIER_DISPLAY[requiredTier].name;
  // Same display-honesty filter as settings/billing: the currency board
  // does not exist anywhere in the app while CURRENCY_ENGINE_ENABLED is
  // off, so it must not be advertised as an upgrade incentive either.
  const currencyVisible = isCurrencyEngineEnabled();
  const added = featuresAddedByTier(requiredTier).filter(
    (id) => currencyVisible || id !== "currency"
  );

  return (
    <PageShell
      title={feature ? `${FEATURES[feature].label} is a ${tierName} feature` : "Upgrade your plan"}
      subtitle={`You're on the ${TIER_DISPLAY[account.plan_tier].name} plan.`}
    >
      <Card>
        <Flex direction="column" gap="3" p="1">
          <Flex align="center" gap="2">
            <Text weight="bold" size="4">
              {tierName}
            </Text>
            <Badge color="blue">Includes this</Badge>
          </Flex>
          <Text size="2" color="gray">
            {TIER_DISPLAY[requiredTier].blurb}
          </Text>
          <Flex direction="column" gap="1">
            <Text size="1" weight="bold" color="gray">
              {tierName} adds:
            </Text>
            {added.map((id) => (
              <Text size="1" color="gray" key={id}>
                &bull; {FEATURES[id].label}
                {FEATURES[id].comingSoon ? " (coming soon)" : ""}
              </Text>
            ))}
          </Flex>
          <Text size="2" color="gray">
            {visibleDowngradeNote()}
          </Text>
          <Flex gap="2" mt="1">
            <Button asChild>
              <NextLink href="/settings/billing">See plans &amp; upgrade</NextLink>
            </Button>
            <Button asChild variant="soft" color="gray">
              <NextLink href={DASHBOARD_PATH}>Back to Overview</NextLink>
            </Button>
          </Flex>
        </Flex>
      </Card>
    </PageShell>
  );
}
