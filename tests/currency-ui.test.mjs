import test from "node:test";
import assert from "node:assert/strict";

const {
  STATUS_BADGE_COLOR,
  CURRENCY_CARD_TITLES,
  formatCurrencyDate,
  utcDateOf,
  formatZulu,
  countedEntrySummary,
  isNextControlFlowError,
} = await import("../app/(app)/currency/presentation.ts");

/**
 * Pure presentation helpers for the currency board — the UI layer over
 * lib/currency/**. The engine's own arithmetic is asserted by
 * `npm run currency:verify` (605 checks against a real Postgres) and by
 * tests/currency.test.mjs; nothing here re-tests it. These tests pin the
 * UI-owned surface: the status→badge mapping, the display titles that
 * must not leak the legacy vocabulary keys, and the deterministic date
 * formatting the board itself introduces.
 */

test("status → badge colour covers the engine's three statuses, exactly", async (t) => {
  await t.test("the three hedged statuses map to green / red / amber", () => {
    assert.equal(STATUS_BADGE_COLOR.estimated_current, "green");
    assert.equal(STATUS_BADGE_COLOR.estimated_not_current, "red");
    // Deliberately amber, not gray: "we could not find out" is
    // safety-relevant information on a currency board, and it must not
    // fade into the chrome as if it were mere absence.
    assert.equal(STATUS_BADGE_COLOR.insufficient_data, "amber");
  });

  await t.test("no fourth status exists in the mapping", () => {
    // The engine's vocabulary is fixed at three (docs/CURRENCY-SPEC.md
    // §6: "No fourth state, no 'expiring soon' state"). A fourth key here
    // would mean the UI invented a status the engine never emits.
    assert.deepEqual(Object.keys(STATUS_BADGE_COLOR).sort(), [
      "estimated_current",
      "estimated_not_current",
      "insufficient_data",
    ]);
  });
});

test("card titles cover the five currency types and honour the vocabulary rules", async (t) => {
  await t.test("exactly the five locked currency types are titled", () => {
    assert.deepEqual(Object.keys(CURRENCY_CARD_TITLES).sort(), [
      "flight_review",
      "instrument",
      "medical",
      "passenger_day",
      "passenger_night",
    ]);
  });

  await t.test("the legacy 'passenger_day' key never leaks into its display copy", () => {
    // docs/CURRENCY-SPEC.md §2.1: 61.57(a) is NOT passenger currency and
    // NOT day-only — it reaches an empty repositioning leg in any
    // two-crew aircraft, at any hour. The storage key is locked legacy
    // vocabulary; the display label must not repeat its two errors.
    const { title } = CURRENCY_CARD_TITLES.passenger_day;
    assert.doesNotMatch(title, /passenger/i);
    assert.doesNotMatch(title, /\bday\b/i);
  });

  await t.test("no title or subtitle ever claims legality or certainty", () => {
    // "Estimated" is the whole claim. The engine's hedged vocabulary
    // must not be undone by a stronger word in the UI layer's own copy.
    for (const [type, { title, subtitle }] of Object.entries(CURRENCY_CARD_TITLES)) {
      for (const copy of [title, subtitle]) {
        assert.doesNotMatch(copy, /\blegal\b/i, `${type} says "legal"`);
        assert.doesNotMatch(copy, /\bcompliant\b/i, `${type} says "compliant"`);
        assert.doesNotMatch(copy, /you are current/i, `${type} asserts currency`);
        assert.doesNotMatch(copy, /\bguarantee/i, `${type} guarantees`);
      }
    }
  });

  await t.test("the night card carries the full-stop and window language", () => {
    // The single most dangerous silent error available in this product
    // (docs/CURRENCY-SPEC.md §2.2) is conflating logged night time with
    // the 61.57(b)(1) window. The card subtitle must carry both facts.
    const { subtitle } = CURRENCY_CARD_TITLES.passenger_night;
    // Hyphen or space: "full-stop takeoffs and landings" hyphenates
    // correctly as a compound adjective, and the copy is free to. What
    // must not disappear is the phrase itself.
    assert.match(subtitle, /full[-\s]stop/i);
    assert.match(subtitle, /1 hour after sunset/i);
  });

  await t.test("calendar-month language is exact, never a day-count approximation", () => {
    assert.match(CURRENCY_CARD_TITLES.instrument.subtitle, /6 calendar months/);
    assert.match(CURRENCY_CARD_TITLES.flight_review.subtitle, /24th calendar month/);
    // "180 days" or "730 days" here would be the exact approximation the
    // spec's worked examples exist to forbid.
    assert.doesNotMatch(CURRENCY_CARD_TITLES.instrument.subtitle, /180/);
    assert.doesNotMatch(CURRENCY_CARD_TITLES.flight_review.subtitle, /730/);
  });
});

test("formatCurrencyDate renders DD MON YYYY and refuses malformed dates", async (t) => {
  await t.test("the spec's own worked-example style", () => {
    assert.equal(formatCurrencyDate("2026-08-05"), "05 AUG 2026");
    assert.equal(formatCurrencyDate("2026-02-01"), "01 FEB 2026");
    assert.equal(formatCurrencyDate("2024-12-31"), "31 DEC 2024");
  });

  await t.test("leap day is valid in a leap year and refused otherwise", () => {
    // The spec's own fixture list names February in a leap year (2028)
    // as a case the engine must get right; the formatter must not
    // 'helpfully' roll 29 FEB 2027 into March the way Date() would.
    assert.equal(formatCurrencyDate("2028-02-29"), "29 FEB 2028");
    assert.equal(formatCurrencyDate("2027-02-29"), null);
    assert.equal(formatCurrencyDate("2000-02-29"), "29 FEB 2000"); // 400-rule leap year
    assert.equal(formatCurrencyDate("1900-02-29"), null); // 100-rule non-leap year
  });

  await t.test("malformed input returns null, never a wrong date", () => {
    assert.equal(formatCurrencyDate(null), null);
    assert.equal(formatCurrencyDate(undefined), null);
    assert.equal(formatCurrencyDate(""), null);
    assert.equal(formatCurrencyDate("2026-13-01"), null);
    assert.equal(formatCurrencyDate("2026-00-10"), null);
    assert.equal(formatCurrencyDate("2026-04-31"), null);
    assert.equal(formatCurrencyDate("08/05/2026"), null);
    assert.equal(formatCurrencyDate("2026-8-5"), null); // not zero-padded ISO
  });
});

test("utcDateOf is the UTC calendar date, not the local one", async (t) => {
  await t.test("an evening west of Greenwich is already tomorrow in UTC", () => {
    // The exact mismatch lib/currency/read.ts documents: 20:00 in New
    // York on the 11th is 00:00 UTC on the 12th. The board keys every
    // as-of on THIS convention so the page render and the recompute
    // action can never disagree about which date they evaluated.
    assert.equal(utcDateOf(new Date("2026-08-11T20:00:00-04:00")), "2026-08-12");
    assert.equal(utcDateOf(new Date("2026-08-11T12:00:00Z")), "2026-08-11");
  });
});

test("formatZulu renders the aviation reference frame", async (t) => {
  await t.test("24-hour Zulu, zero-padded, with the ops-style date", () => {
    assert.equal(formatZulu("2026-08-11T14:03:00Z"), "1403Z on 11 AUG 2026");
    assert.equal(formatZulu("2026-01-02T00:00:00Z"), "0000Z on 02 JAN 2026");
    // A local-offset timestamp is converted, not echoed: 20:30-04:00 is
    // 0030Z the next day.
    assert.equal(formatZulu("2026-08-11T20:30:00-04:00"), "0030Z on 12 AUG 2026");
  });

  await t.test("an unparseable timestamp returns null, never NaN in prose", () => {
    assert.equal(formatZulu("not a timestamp"), null);
    assert.equal(formatZulu(""), null);
  });
});

test("countedEntrySummary shows movements and never renders an all-zero row as zeros", async (t) => {
  await t.test("plural and singular forms", () => {
    assert.equal(
      countedEntrySummary({ takeoffs: 2, landings: 2, approaches: 0 }),
      "2 takeoffs, 2 landings"
    );
    assert.equal(
      countedEntrySummary({ takeoffs: 1, landings: 1, approaches: 0 }),
      "1 takeoff, 1 landing"
    );
    assert.equal(
      countedEntrySummary({ takeoffs: 0, landings: 0, approaches: 3 }),
      "3 approaches"
    );
    assert.equal(
      countedEntrySummary({ takeoffs: 0, landings: 0, approaches: 1 }),
      "1 approach"
    );
  });

  await t.test("a task-only row (holding / course intercept) says why it counted", () => {
    // The instrument card lists rows counted for holding or for
    // intercepting and tracking a course. Rendering one as "0 takeoffs,
    // 0 landings" would read as "this entry contributed nothing" — the
    // opposite of why the engine listed it.
    const summary = countedEntrySummary({ takeoffs: 0, landings: 0, approaches: 0 });
    assert.doesNotMatch(summary, /0 takeoffs/);
    assert.match(summary, /holding/i);
    assert.match(summary, /intercepting and tracking/i);
  });
});

test("isNextControlFlowError recognises redirects and nothing else", async (t) => {
  await t.test("redirect and notFound digests pass", () => {
    assert.equal(isNextControlFlowError({ digest: "NEXT_REDIRECT;replace;/login;307;" }), true);
    assert.equal(isNextControlFlowError({ digest: "NEXT_NOT_FOUND" }), true);
  });

  await t.test("real failures do not — they must render the refuse state", () => {
    // Swallowing a redirect breaks login; rethrowing a real read failure
    // would crash the page instead of rendering the honest refuse state.
    // Both directions matter, so both are pinned.
    assert.equal(isNextControlFlowError(new Error("failed to load pilot.logbook_entries")), false);
    assert.equal(isNextControlFlowError({ digest: 42 }), false);
    assert.equal(isNextControlFlowError(null), false);
    assert.equal(isNextControlFlowError(undefined), false);
    assert.equal(isNextControlFlowError("NEXT_REDIRECT"), false);
  });
});
