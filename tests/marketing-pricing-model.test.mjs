import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const {
  publicMatrix,
  publicTierAdds,
  publicCoreFeatures,
  isPubliclyClaimable,
  PUBLIC_CLAIM_FILTER,
  TIER_ORDER,
  TIER_PRICE_COPY,
  BUSINESS_MINIMUM_MONTHLY,
  BUSINESS_MINIMUM_ANNUAL,
} = await import("../app/(marketing)/pricing/pricing-model.ts");

const { FEATURES, PLAN_TIERS, marketingMatrix } = await import(
  "../lib/entitlements.ts"
);

const { CURRENCY_PATH, visibleNavSections } = await import("../lib/nav.ts");
const { parseDollarsToCents } = await import("../lib/format.ts");

/**
 * The public pricing page's view-model over lib/entitlements.ts. These
 * tests pin the two promises the marketing surface makes that the
 * entitlements module itself cannot enforce:
 *
 * 1. THE COUNSEL GATE. The currency board ships dark behind a deployment
 *    flag; until that gate clears it appears on NO public page, in no
 *    form — not as a row, not as "coming soon" (docs/PRICING.md §4). A
 *    future edit that re-adds it to the public matrix must fail here,
 *    not in review.
 *
 * 2. EVERY PUBLIC CLAIM MAPS TO A ROUTE THAT EXISTS. Each matrix row that
 *    declares routePatterns is walked against the real app/(app) tree —
 *    if a feature's route is deleted or hasn't landed, the pricing page
 *    is claiming software that does not exist, and this suite fails the
 *    build instead of letting the page overclaim. (Rows flagged
 *    comingSoon are exempt: they are rendered AS not-yet-shipped, which
 *    is the honest form docs/PRICING.md §8 allows.)
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP_GROUP = join(REPO_ROOT, "app", "(app)");

// Resolves an entitlements routePattern (e.g. /clients/*/statement, where
// "*" corresponds to a dynamic segment directory like "[id]") against the
// app router tree. Returns true only when some real directory chain
// matches every segment AND the matched directory actually serves — a
// page.tsx or route.ts at its root. A directory holding only helper
// files is not a route, and the pricing page must not claim it as one
// (this exact case occurred mid-session: app/(app)/accounting existed
// for a while as a lib file with no page).
function routeExists(pattern) {
  const segments = pattern.split("/").filter(Boolean);
  let candidates = [APP_GROUP];
  for (const segment of segments) {
    const next = [];
    for (const dir of candidates) {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (!statSync(full).isDirectory()) continue;
        const isDynamic = entry.startsWith("[") && entry.endsWith("]");
        if (segment === "*" ? isDynamic : entry === segment) next.push(full);
      }
    }
    if (next.length === 0) return false;
    candidates = next;
  }
  return candidates.some(
    (dir) =>
      existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts"))
  );
}

test("the counsel-gated currency board appears nowhere public", () => {
  assert.equal(isPubliclyClaimable("currency"), false);
  for (const row of publicMatrix()) {
    assert.notEqual(row.feature, "currency");
    assert.doesNotMatch(row.label, /currency/i);
  }
  for (const tier of PLAN_TIERS) {
    for (const item of publicTierAdds(tier)) {
      assert.notEqual(item.id, "currency");
      assert.doesNotMatch(item.label, /currency/i);
    }
  }
  for (const item of publicCoreFeatures()) {
    assert.notEqual(item.id, "currency");
    assert.doesNotMatch(item.label, /currency/i);
  }
});

test("the public matrix is the entitlements matrix minus exactly the declared filter", () => {
  // The absolute rule first: currency stays filtered until its gate clears.
  assert.equal(PUBLIC_CLAIM_FILTER.includes("currency"), true);

  const publicIds = new Set(publicMatrix().map((row) => row.feature));
  for (const row of marketingMatrix()) {
    if (PUBLIC_CLAIM_FILTER.includes(row.feature)) {
      assert.equal(publicIds.has(row.feature), false);
    } else {
      assert.equal(
        publicIds.has(row.feature),
        true,
        `${row.feature} missing from the public matrix`
      );
    }
  }
});

test("every published claim maps to a route that exists in the tree", () => {
  for (const row of publicMatrix()) {
    if (row.comingSoon) continue; // rendered as not-yet-shipped, honestly
    for (const pattern of FEATURES[row.feature].routePatterns) {
      assert.equal(
        routeExists(pattern),
        true,
        `pricing page claims "${row.label}" but ${pattern} has no route under app/(app)`
      );
    }
  }
});

test("the marketing product mock's nav source is currency-free", () => {
  // app/(marketing)/product-mock.tsx renders visibleNavSections(false) —
  // the flag-off view — so the public landing page can never show the
  // counsel-gated section in its rail. Pin the source it renders from.
  const sections = visibleNavSections(false);
  for (const item of sections) {
    assert.notEqual(item.href, CURRENCY_PATH);
    assert.doesNotMatch(item.label, /currency/i);
  }
});

test("never-gated rows are available on every tier (records are never paywalled)", () => {
  for (const row of publicMatrix()) {
    if (FEATURES[row.feature].minTier !== "solo") continue;
    for (const tier of PLAN_TIERS) {
      assert.equal(
        row.availability[tier],
        true,
        `${row.feature} must be included in ${tier}`
      );
    }
  }
});

test("the ladder is strict: a higher tier never lacks a lower tier's feature", () => {
  for (const row of publicMatrix()) {
    if (row.availability.solo) assert.equal(row.availability.pro, true);
    if (row.availability.pro) assert.equal(row.availability.business, true);
  }
});

test("tier order and price copy match docs/PRICING.md §3.2", () => {
  assert.deepEqual([...TIER_ORDER], ["solo", "pro", "business"]);

  const dollars = (label) => {
    assert.match(label, /^\$\d+$/, `${label} is not integer-dollar copy`);
    return Number(label.slice(1));
  };

  assert.equal(dollars(TIER_PRICE_COPY.solo.monthly), 29);
  assert.equal(dollars(TIER_PRICE_COPY.pro.monthly), 49);
  assert.equal(dollars(TIER_PRICE_COPY.business.monthly), 39);

  for (const tier of TIER_ORDER) {
    const copy = TIER_PRICE_COPY[tier];
    // Annual is two months free on every tier — 10× monthly, exactly.
    assert.equal(dollars(copy.annual), dollars(copy.monthly) * 10);
  }

  assert.equal(TIER_PRICE_COPY.solo.unit, "flat");
  assert.equal(TIER_PRICE_COPY.pro.unit, "flat");
  assert.equal(TIER_PRICE_COPY.business.unit, "per seat");
  assert.equal(TIER_PRICE_COPY.business.seatMinimum, 2);
  assert.equal(
    dollars(BUSINESS_MINIMUM_MONTHLY),
    dollars(TIER_PRICE_COPY.business.monthly) * TIER_PRICE_COPY.business.seatMinimum
  );
  assert.equal(
    dollars(BUSINESS_MINIMUM_ANNUAL),
    dollars(TIER_PRICE_COPY.business.annual) * TIER_PRICE_COPY.business.seatMinimum
  );
});

test("TIER_PRICE_COPY parses to the cents the price-drift guard checks against", () => {
  // lib/stripe/price-drift.ts compares these SAME strings (parsed the SAME
  // way, via lib/format.ts's parseDollarsToCents) against live Stripe
  // Price.unit_amount. scripts/billing-verify.mjs additionally hardcodes
  // this exact cents table (it cannot import a .ts module — see that
  // script's price-drift section) — if this test ever fails because
  // TIER_PRICE_COPY changed, billing-verify.mjs's duplicate copy must
  // change with it, or the drift guard itself goes stale.
  const expectedCents = {
    solo: { monthly: 2900, annual: 29000 },
    pro: { monthly: 4900, annual: 49000 },
    business: { monthly: 3900, annual: 39000 },
  };
  for (const tier of TIER_ORDER) {
    for (const interval of ["monthly", "annual"]) {
      assert.equal(
        parseDollarsToCents(TIER_PRICE_COPY[tier][interval]),
        expectedCents[tier][interval],
        `${tier}/${interval} cents mismatch — update scripts/billing-verify.mjs's duplicate table too`
      );
    }
  }
});
