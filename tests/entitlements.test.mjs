import test from "node:test";
import assert from "node:assert/strict";

const {
  PLAN_TIERS,
  TIER_RANK,
  TIER_DISPLAY,
  TIER_PRICE_ENV,
  BILLING_INTERVALS,
  FEATURES,
  isPlanTier,
  isBillingInterval,
  isFeatureId,
  isEntitled,
  featuresAddedByTier,
  featureForPath,
  tierForPriceId,
  marketingMatrix,
  DOWNGRADE_NOTE,
} = await import("../lib/entitlements.ts");

/**
 * lib/entitlements.ts is the single source for tier logic — the welcome
 * picker, settings/billing, requireEntitlement, the webhook's price→tier
 * mapping, and the public pricing matrix all read it. These tests pin
 * the parts where quiet drift would either mischarge someone (the env
 * NAMES the deployment is configured against) or violate the owner's
 * gating principle (safety records are never gated). All fixtures
 * synthetic.
 */

test("the tier ladder is solo < pro < business and nothing else", () => {
  assert.deepEqual([...PLAN_TIERS], ["solo", "pro", "business"]);
  assert.ok(TIER_RANK.solo < TIER_RANK.pro);
  assert.ok(TIER_RANK.pro < TIER_RANK.business);
  for (const tier of PLAN_TIERS) {
    assert.ok(isPlanTier(tier));
    assert.ok(TIER_DISPLAY[tier].name.length > 0, `${tier} has a display name`);
  }
  assert.equal(isPlanTier("enterprise"), false);
  assert.equal(isPlanTier(null), false);
});

/**
 * THE GATING PRINCIPLE, pinned. The owner's brief: tiers gate business
 * depth, never safety records. A pilot's logbook (61.51 makes its upkeep
 * the pilot's own duty), the currency board, and the documents wallet —
 * plus the working core of trips/invoices/expenses — must be in EVERY
 * tier. If this test starts failing, someone is trying to sell a safety
 * record back to its owner; the fix is the feature map, not this test.
 */
test("safety records and the working core are never gated", () => {
  const everyTier = [
    "logbook",
    "currency",
    "documents",
    "trips",
    "invoices",
    "expenses",
    "clients",
    "reports_core",
    "weather",
  ];
  for (const feature of everyTier) {
    assert.equal(
      FEATURES[feature].minTier,
      "solo",
      `${feature} must be included in every tier`
    );
    for (const tier of PLAN_TIERS) {
      assert.ok(isEntitled(tier, feature), `${tier} must include ${feature}`);
    }
    assert.equal(
      FEATURES[feature].routePatterns.length,
      0,
      `${feature} must not appear in the route-gate map at all — a bug in ` +
        `featureForPath can then only ever over-ask for a tier, never lock a safety record`
    );
  }
});

test("pro gates exactly the business-office set, and business includes all of pro", () => {
  const proAdds = featuresAddedByTier("pro").sort();
  assert.deepEqual(proAdds, [
    "bank_import",
    "client_statements",
    "estimates",
    "recurring_invoices",
    "sales_tax_report",
  ]);
  for (const feature of proAdds) {
    assert.equal(isEntitled("solo", feature), false, `solo must not include ${feature}`);
    assert.ok(isEntitled("pro", feature));
    assert.ok(isEntitled("business", feature), `higher tiers include lower — ${feature}`);
  }

  const businessAdds = featuresAddedByTier("business").sort();
  assert.deepEqual(businessAdds, ["accounting", "multi_seat", "priority_support"]);
  for (const feature of businessAdds) {
    assert.equal(isEntitled("solo", feature), false);
    assert.equal(isEntitled("pro", feature), false);
    assert.ok(isEntitled("business", feature));
  }
});

test("route gating finds the gated child under an ungated parent, per segment", () => {
  // Gated children of ungated sections.
  assert.equal(featureForPath("/invoices/recurring"), "recurring_invoices");
  assert.equal(featureForPath("/invoices/recurring/anything/nested"), "recurring_invoices");
  assert.equal(featureForPath("/invoices"), null);
  assert.equal(featureForPath("/invoices/123"), null);

  assert.equal(featureForPath("/estimates"), "estimates");
  assert.equal(featureForPath("/estimates/new"), "estimates");

  // The "*" segment: /clients/:id/statement, but never /clients or the
  // client screen itself.
  assert.equal(featureForPath("/clients/abc-123/statement"), "client_statements");
  assert.equal(featureForPath("/clients/abc-123/statement/print"), "client_statements");
  assert.equal(featureForPath("/clients/abc-123"), null);
  assert.equal(featureForPath("/clients"), null);

  assert.equal(featureForPath("/expenses/import"), "bank_import");
  assert.equal(featureForPath("/expenses/transactions"), "bank_import");
  assert.equal(featureForPath("/expenses"), null);

  assert.equal(featureForPath("/reports/sales-tax"), "sales_tax_report");
  assert.equal(featureForPath("/reports/year-end"), null);
  assert.equal(featureForPath("/reports"), null);

  assert.equal(featureForPath("/settings/export"), "account_export");
  assert.equal(featureForPath("/settings/export/invoices"), "account_export");
  assert.equal(featureForPath("/settings"), null);
  assert.equal(featureForPath("/settings/billing"), null);
  assert.equal(featureForPath("/settings/billing/upgrade"), null);

  // The accounting layer is gated by prefix — the whole subtree, built
  // by another workstream, without naming its child routes here.
  assert.equal(featureForPath("/accounting"), "accounting");
  assert.equal(featureForPath("/accounting/ledger"), "accounting");
  assert.equal(featureForPath("/accounting/reconciliation/2026-07"), "accounting");

  // Balance-sheet and cash-flow live under /reports/*, not /accounting,
  // but are the same Business-tier feature and gated inline the same way
  // — the route→feature map must claim them too, or a future path-based
  // enforcement caller would silently leave both open.
  assert.equal(featureForPath("/reports/balance-sheet"), "accounting");
  assert.equal(featureForPath("/reports/balance-sheet/export"), "accounting");
  assert.equal(featureForPath("/reports/cash-flow"), "accounting");
  assert.equal(featureForPath("/reports/cash-flow/export"), "accounting");
  // sales-tax stays its own feature — adjacent under /reports, not folded in.
  assert.equal(featureForPath("/reports/sales-tax"), "sales_tax_report");

  // Matching is per-SEGMENT, not per-character: a sibling route that
  // merely starts with the same letters is not gated.
  assert.equal(featureForPath("/estimates-archive"), null);
  assert.equal(featureForPath("/accounting-notes"), null);

  // Safety-record routes: never gated (their features carry no patterns).
  assert.equal(featureForPath("/logbook"), null);
  assert.equal(featureForPath("/logbook/import"), null);
  assert.equal(featureForPath("/logbook/export"), null);
  assert.equal(featureForPath("/documents"), null);
});

/**
 * The env-var NAMES are deployment configuration: Vercel and .env.local
 * are keyed to these exact strings, and the webhook maps prices back
 * through them. Renaming one here without migrating the deployment
 * would silently un-map a tier — every subscription on it would stop
 * syncing plan_tier. So the spellings are pinned verbatim.
 */
test("the six price env-var names are pinned verbatim", () => {
  assert.deepEqual(TIER_PRICE_ENV, {
    solo: {
      monthly: "STRIPE_PRICE_ID_SOLO",
      annual: "STRIPE_PRICE_ID_SOLO_ANNUAL",
    },
    pro: {
      monthly: "STRIPE_PRICE_ID_PRO",
      annual: "STRIPE_PRICE_ID_PRO_ANNUAL",
    },
    business: {
      monthly: "STRIPE_PRICE_ID_BUSINESS",
      annual: "STRIPE_PRICE_ID_BUSINESS_ANNUAL",
    },
  });
  assert.deepEqual([...BILLING_INTERVALS], ["monthly", "annual"]);
  assert.ok(isBillingInterval("annual"));
  assert.equal(isBillingInterval("yearly"), false);
});

test("tierForPriceId maps each configured price to its tier and interval", () => {
  const env = {
    STRIPE_PRICE_ID_SOLO: "price_solo_m",
    STRIPE_PRICE_ID_SOLO_ANNUAL: "price_solo_a",
    STRIPE_PRICE_ID_PRO: "price_pro_m",
    STRIPE_PRICE_ID_PRO_ANNUAL: "price_pro_a",
    STRIPE_PRICE_ID_BUSINESS: "price_biz_m",
    STRIPE_PRICE_ID_BUSINESS_ANNUAL: "price_biz_a",
  };
  assert.deepEqual(tierForPriceId("price_solo_m", env), { tier: "solo", interval: "monthly" });
  assert.deepEqual(tierForPriceId("price_solo_a", env), { tier: "solo", interval: "annual" });
  assert.deepEqual(tierForPriceId("price_pro_m", env), { tier: "pro", interval: "monthly" });
  assert.deepEqual(tierForPriceId("price_pro_a", env), { tier: "pro", interval: "annual" });
  assert.deepEqual(tierForPriceId("price_biz_m", env), { tier: "business", interval: "monthly" });
  assert.deepEqual(tierForPriceId("price_biz_a", env), { tier: "business", interval: "annual" });
  assert.equal(tierForPriceId("price_someone_elses", env), null);
});

/**
 * The case that would actually hurt: an UNSET env var must never match
 * anything. `env[name] === priceId` with both undefined — or both "" —
 * is true in JavaScript, and the first draft of a mapping like this is
 * exactly where that bug lives. A webhook payload with a null/empty
 * price must map to no tier, not to whichever tier happens to be
 * unconfigured.
 */
test("unset or empty env values never match, and null/empty price ids map nowhere", () => {
  const partial = { STRIPE_PRICE_ID_PRO: "price_pro_m", STRIPE_PRICE_ID_SOLO: "" };
  assert.equal(tierForPriceId(undefined, partial), null);
  assert.equal(tierForPriceId(null, partial), null);
  assert.equal(tierForPriceId("", partial), null);
  // "" price vs "" configured value: must NOT match solo.
  assert.equal(tierForPriceId("", { STRIPE_PRICE_ID_SOLO: "" }), null);
  // undefined price vs missing var: must NOT match anything.
  assert.equal(tierForPriceId(undefined, {}), null);
  // A real id still maps with everything else unset.
  assert.deepEqual(tierForPriceId("price_pro_m", partial), { tier: "pro", interval: "monthly" });
});

test("the marketing matrix covers every feature once, honestly", () => {
  const rows = marketingMatrix();
  const ids = rows.map((r) => r.feature);
  assert.equal(new Set(ids).size, ids.length, "no feature listed twice");
  assert.deepEqual(new Set(ids), new Set(Object.keys(FEATURES)), "every feature listed");
  for (const row of rows) {
    assert.ok(row.label.length > 0);
    // Availability is a ladder: never available at a lower tier while
    // unavailable at a higher one.
    assert.ok(!row.availability.solo || row.availability.pro);
    assert.ok(!row.availability.pro || row.availability.business);
    // Everything is in business — the top tier is the whole product.
    assert.ok(row.availability.business);
  }
  // The multi-seat placeholder must be flagged coming-soon until the
  // invite UI exists (docs/PRICING.md §6: never imply unshipped features
  // are shipped).
  const multiSeat = rows.find((r) => r.feature === "multi_seat");
  assert.equal(multiSeat.comingSoon, true);
  assert.ok(isFeatureId("estimates"));
  assert.equal(isFeatureId("payroll"), false);
});

test("the downgrade promise names the never-gated records", () => {
  assert.match(DOWNGRADE_NOTE, /never deletes/i);
  assert.match(DOWNGRADE_NOTE, /logbook/i);
});
