import test from "node:test";
import assert from "node:assert/strict";

const {
  ACCOUNT_STATUSES,
  statusDisplay,
  statusIsWritable,
  daysUntil,
  trialDaysRemaining,
  renewalNotice,
  renewalText,
} = await import("../lib/billing-state.ts");

const { ACCOUNT_WRITABLE_STATUSES } = await import("../lib/entitlements.ts");

const NOW = new Date("2026-08-13T12:00:00.000Z");

test("every status in the CHECK has a label, a tone and a meaning", () => {
  for (const status of ACCOUNT_STATUSES) {
    const display = statusDisplay(status);
    assert.ok(display.label, `${status} has no label`);
    assert.ok(display.tone, `${status} has no tone`);
    assert.ok(
      display.meaning.length > 20,
      `${status}'s meaning is too thin to be worth showing`
    );
    // The meaning must not merely restate the label.
    assert.notEqual(display.meaning, display.label);
  }
});

test("a status this build has never seen is described honestly, not crashed on", () => {
  const display = statusDisplay("some_future_stripe_status");
  assert.equal(display.label, "some_future_stripe_status");
  assert.match(display.meaning, /doesn't have a description/);
});

test("every NON-writable status says so in its meaning", () => {
  // The single most surprising thing this screen has to explain is why an
  // account stopped accepting writes. If a read-only status's copy never
  // mentions it, the banner is decoration.
  for (const status of ACCOUNT_STATUSES) {
    if (statusIsWritable(status)) continue;
    assert.match(
      statusDisplay(status).meaning,
      /read-only/,
      `${status} is read-only but never says so`
    );
  }
});

test("writability is read from entitlements, not restated", () => {
  for (const status of ACCOUNT_STATUSES) {
    assert.equal(
      statusIsWritable(status),
      ACCOUNT_WRITABLE_STATUSES.includes(status),
      `${status} disagrees with lib/entitlements.ts`
    );
  }
});

test("daysUntil rounds UP and never goes negative", () => {
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil("not a date", NOW), null);
  // Eleven hours left is 1 day, not 0 — a trial with an evening in it has
  // not ended.
  assert.equal(daysUntil("2026-08-13T23:00:00.000Z", NOW), 1);
  assert.equal(daysUntil("2026-08-20T12:00:00.000Z", NOW), 7);
  // Already past clamps to 0; "expired" is a different sentence.
  assert.equal(daysUntil("2026-08-01T00:00:00.000Z", NOW), 0);
  assert.equal(daysUntil("2026-08-13T12:00:00.000Z", NOW), 0);
});

test("trial days are gated on the STATUS, not just on the column", () => {
  // trial_ends_at is never cleared when a trial converts. Counting from it
  // regardless would print a trial countdown to a paying customer forever.
  assert.equal(trialDaysRemaining("active", "2026-08-20T12:00:00.000Z", NOW), null);
  assert.equal(trialDaysRemaining("canceled", "2026-08-20T12:00:00.000Z", NOW), null);
  assert.equal(trialDaysRemaining("trialing", "2026-08-20T12:00:00.000Z", NOW), 7);
  assert.equal(trialDaysRemaining("trialing", null, NOW), null);
});

test("a pending cancellation outranks everything else", () => {
  const notice = renewalNotice(
    {
      status: "trialing",
      cancelAtPeriodEnd: true,
      periodEndIso: "2026-09-01T00:00:00.000Z",
      trialEndsAtIso: "2026-08-20T12:00:00.000Z",
    },
    NOW
  );
  assert.equal(notice.kind, "cancels");
  assert.equal(notice.dateIso, "2026-09-01T00:00:00.000Z");
  assert.match(renewalText(notice, "Sep 1, 2026"), /cancel on Sep 1, 2026/);
});

test("a cancellation with no readable period end still says it is cancelling", () => {
  const notice = renewalNotice(
    {
      status: "active",
      cancelAtPeriodEnd: true,
      periodEndIso: null,
      trialEndsAtIso: null,
    },
    NOW
  );
  assert.equal(notice.kind, "cancels");
  assert.equal(notice.dateIso, null);
  // No {date} placeholder left dangling in the version with no date.
  assert.doesNotMatch(notice.template, /\{date\}/);
});

test("a live trial names the charge date and turns cautionary near the end", () => {
  const week = renewalNotice(
    {
      status: "trialing",
      cancelAtPeriodEnd: false,
      periodEndIso: "2026-09-01T00:00:00.000Z",
      trialEndsAtIso: "2026-08-20T12:00:00.000Z",
    },
    NOW
  );
  assert.equal(week.kind, "trial");
  assert.equal(week.days, 7);
  assert.equal(week.tone, "blue");
  assert.match(renewalText(week, "Aug 20, 2026"), /7 days left.*Aug 20, 2026/s);

  const tomorrow = renewalNotice(
    {
      status: "trialing",
      cancelAtPeriodEnd: false,
      periodEndIso: null,
      trialEndsAtIso: "2026-08-14T12:00:00.000Z",
    },
    NOW
  );
  assert.equal(tomorrow.days, 1);
  assert.equal(tomorrow.tone, "amber");
  assert.match(tomorrow.template, /^1 day left/);
});

test("a plain renewal is stated only when a period end was actually read", () => {
  const known = renewalNotice(
    {
      status: "active",
      cancelAtPeriodEnd: false,
      periodEndIso: "2026-09-01T00:00:00.000Z",
      trialEndsAtIso: "2026-01-01T00:00:00.000Z",
    },
    NOW
  );
  assert.equal(known.kind, "renews");
  assert.match(renewalText(known, "Sep 1, 2026"), /Renews automatically on Sep 1, 2026/);

  const unknown = renewalNotice(
    {
      status: "active",
      cancelAtPeriodEnd: false,
      periodEndIso: null,
      trialEndsAtIso: null,
    },
    NOW
  );
  // Stripe unreachable: say nothing rather than invent a date.
  assert.equal(unknown.kind, "none");
  assert.equal(unknown.template, "");
});

test("a lapsed account gets no renewal line — the status banner owns that state", () => {
  for (const status of ACCOUNT_STATUSES) {
    if (statusIsWritable(status)) continue;
    const notice = renewalNotice(
      {
        status,
        cancelAtPeriodEnd: false,
        periodEndIso: "2026-09-01T00:00:00.000Z",
        trialEndsAtIso: null,
      },
      NOW
    );
    assert.equal(notice.kind, "none", `${status} contradicted its own banner`);
  }
});

test("renewalText substitutes the caller's formatted date and leaves no placeholder", () => {
  const notice = renewalNotice(
    {
      status: "active",
      cancelAtPeriodEnd: false,
      periodEndIso: "2026-09-01T00:00:00.000Z",
      trialEndsAtIso: null,
    },
    NOW
  );
  const text = renewalText(notice, "Sep 1, 2026");
  assert.doesNotMatch(text, /\{date\}/);
});
