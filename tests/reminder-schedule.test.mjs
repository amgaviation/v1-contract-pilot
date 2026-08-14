import test from "node:test";
import assert from "node:assert/strict";

const {
  REMINDER_BEFORE_DAYS,
  REMINDER_AFTER_DAYS,
  EMPTY_REMINDER_POLICY,
  normalizeReminderPolicy,
  reminderPolicyIsEmpty,
  rungKey,
  rungsFor,
  describeRung,
  decideReminder,
  describeHold,
  QUIET_PERIOD_DAYS,
  RECENTLY_VIEWED_DAYS,
  normalizeLateFeePolicy,
  hasLateFee,
  lateFeeStartDate,
  quoteLateFee,
  lateFeeLineDescription,
  describeLateFeePolicy,
  lateFeeReminderSentence,
  formatBps,
  addDays,
  daysBetween,
  daysSinceInstant,
  addMonthsClamped,
  completeMonthsBetween,
  isCalendarDate,
} = await import("../lib/reminders/policy.ts");

/**
 * The scheduler's judgement, pinned.
 *
 * Everything in this file is about mail that leaves the building without a
 * human present. A mistake in the message copy is visible to the pilot's
 * client; a mistake HERE is visible to them four times in one minute, or not
 * at all until they stop paying. So the cases that get the most attention are
 * the ones nobody would hit by hand: a ladder switched on for an already-late
 * invoice, a rerun of the same day, and the two days a year a local-time day
 * is not 24 hours long.
 */

const LADDER = { beforeDue: [7], onDue: true, afterDue: [3, 7, 14, 30] };
const BASE = {
  policy: LADDER,
  dueOn: "2026-09-10",
  today: "2026-09-10",
  consumed: [],
  lastReminderAt: null,
  sentAt: null,
  lastViewedAt: null,
  suppressed: false,
};

test("calendar arithmetic survives the two days a year local time doesn't", async (t) => {
  await t.test("spring forward — a 23-hour local day is still one day", () => {
    // 2026-03-08 is the US DST start. A millisecond-count implementation
    // (+86,400,000) lands on 2026-03-08T23:00 local and formats as the 8th
    // again in a local-time renderer; UTC components cannot.
    assert.equal(addDays("2026-03-07", 1), "2026-03-08");
    assert.equal(addDays("2026-03-08", 1), "2026-03-09");
    assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
  });

  await t.test("fall back — a 25-hour local day is still one day", () => {
    assert.equal(addDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addDays("2026-11-01", 1), "2026-11-02");
    assert.equal(daysBetween("2026-10-31", "2026-11-02"), 2);
  });

  await t.test("month, year and leap-day boundaries", () => {
    assert.equal(addDays("2026-01-31", 1), "2026-02-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29"); // 2028 is a leap year
    assert.equal(addDays("2027-02-28", 1), "2027-03-01"); // 2027 is not
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });

  await t.test("rejects dates that do not exist", () => {
    assert.equal(isCalendarDate("2026-02-30"), false);
    assert.equal(isCalendarDate("2026-13-01"), false);
    assert.equal(isCalendarDate("2026-9-10"), false);
    assert.equal(isCalendarDate("2026-09-10"), true);
  });

  await t.test("an unparseable instant is no information, not today", () => {
    // Reading it as 0 days ago would hold the ladder forever on one bad row.
    assert.equal(daysSinceInstant("not a date", "2026-09-10"), null);
    assert.equal(daysSinceInstant("2026-09-08T23:30:00Z", "2026-09-10"), 2);
  });
});

test("calendar months clamp rather than creep or skip", async (t) => {
  await t.test("the 31st in a short month is the last day of it", () => {
    assert.equal(addMonthsClamped("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonthsClamped("2028-01-31", 1), "2028-02-29");
    assert.equal(addMonthsClamped("2026-01-31", 2), "2026-03-31");
    assert.equal(addMonthsClamped("2026-01-31", 3), "2026-04-30");
  });

  await t.test("crossing a year", () => {
    assert.equal(addMonthsClamped("2026-11-15", 3), "2027-02-15");
    assert.equal(addMonthsClamped("2026-12-31", 12), "2027-12-31");
  });

  await t.test("a month is complete only when the anniversary has arrived", () => {
    assert.equal(completeMonthsBetween("2026-01-31", "2026-02-27"), 0);
    assert.equal(completeMonthsBetween("2026-01-31", "2026-02-28"), 1);
    assert.equal(completeMonthsBetween("2026-01-31", "2026-03-30"), 1);
    assert.equal(completeMonthsBetween("2026-01-31", "2026-03-31"), 2);
    assert.equal(completeMonthsBetween("2026-01-15", "2027-01-15"), 12);
    // Never negative, whatever order the caller passes.
    assert.equal(completeMonthsBetween("2026-05-01", "2026-04-01"), 0);
  });

  await t.test("a 30-day count would be wrong here, and is not used", () => {
    // February is 28 days. A day-count implementation reports 0 complete
    // "months" on Mar 1 for a Feb 1 start; calendar arithmetic reports 1.
    assert.equal(completeMonthsBetween("2026-02-01", "2026-03-01"), 1);
  });
});

test("the policy normalizer fails to silence, never to noise", async (t) => {
  await t.test("keeps only rungs this build offers", () => {
    const p = normalizeReminderPolicy({
      beforeDue: [7, 9, 14, "3"],
      onDue: true,
      afterDue: [30, 31],
    });
    assert.deepEqual(p.beforeDue, [3, 7, 14]);
    assert.deepEqual(p.afterDue, [30]);
    assert.equal(p.onDue, true);
  });

  await t.test("de-duplicates and sorts", () => {
    const p = normalizeReminderPolicy({ beforeDue: [7, 7, 3], afterDue: [14, 3, 14] });
    assert.deepEqual(p.beforeDue, [3, 7]);
    assert.deepEqual(p.afterDue, [3, 14]);
  });

  await t.test("anything unrecognised resolves to no reminders at all", () => {
    assert.deepEqual(normalizeReminderPolicy({}), EMPTY_REMINDER_POLICY);
    assert.deepEqual(
      normalizeReminderPolicy({ beforeDue: "7", onDue: "yes", afterDue: null }),
      EMPTY_REMINDER_POLICY
    );
    assert.equal(reminderPolicyIsEmpty(normalizeReminderPolicy({})), true);
  });

  await t.test("the offered sets are the ones the database CHECKs pin", () => {
    assert.deepEqual([...REMINDER_BEFORE_DAYS], [3, 7, 14]);
    assert.deepEqual([...REMINDER_AFTER_DAYS], [3, 7, 14, 30]);
  });
});

test("rungs are dated off the due date and keyed once", async (t) => {
  await t.test("keys and dates", () => {
    const rungs = rungsFor({ beforeDue: [7], onDue: true, afterDue: [3] }, "2026-09-10");
    assert.deepEqual(
      rungs.map((r) => [r.key, r.onDate]),
      [
        ["before_7", "2026-09-03"],
        ["on_due", "2026-09-10"],
        ["after_3", "2026-09-13"],
      ]
    );
    assert.equal(rungKey("before", 7), "before_7");
    assert.equal(rungKey("on", 0), "on_due");
    assert.equal(rungKey("after", 30), "after_30");
  });

  await t.test("no due date means no rungs — never an invented one", () => {
    assert.deepEqual(rungsFor(LADDER, null), []);
    assert.deepEqual(rungsFor(LADDER, "whenever"), []);
  });

  await t.test("described for the pilot, in days either side", () => {
    const rungs = rungsFor({ beforeDue: [], onDue: true, afterDue: [3] }, "2026-09-10");
    assert.equal(describeRung(rungs[0]), "On the due date");
    assert.equal(describeRung(rungs[1]), "3 days past due");
  });
});

test("one run sends at most one reminder", async (t) => {
  await t.test("the rung that has just come due", () => {
    const d = decideReminder({ ...BASE, today: "2026-09-10" });
    assert.equal(d.action, "send");
    assert.equal(d.rung.key, "on_due");
  });

  await t.test(
    "a ladder switched on for a 40-day-late invoice sends ONE email, not four",
    () => {
      // The case that matters most: without the supersede rule this is four
      // messages to a real client, in one minute, about one bill.
      const d = decideReminder({ ...BASE, today: "2026-10-20" });
      assert.equal(d.action, "send");
      assert.equal(d.rung.key, "after_30");
      const keys = d.supersede.map((s) => s.rung.key).sort();
      assert.deepEqual(keys, ["after_14", "after_3", "after_7", "before_7", "on_due"]);
      // The before/on rungs are stale (their moment passed), the after ones
      // superseded (a later rung said it better).
      const byKey = Object.fromEntries(d.supersede.map((s) => [s.rung.key, s.reason]));
      assert.equal(byKey.before_7, "stale");
      assert.equal(byKey.on_due, "stale");
      assert.equal(byKey.after_3, "superseded");
      assert.equal(byKey.after_14, "superseded");
    }
  );

  await t.test("a 'due in 7 days' rung is never sent once it is past due", () => {
    // Arriving three weeks late it would be simply false.
    const d = decideReminder({
      ...BASE,
      policy: { beforeDue: [7], onDue: false, afterDue: [] },
      today: "2026-09-25",
    });
    assert.equal(d.action, "consume");
    assert.deepEqual(
      d.supersede.map((s) => [s.rung.key, s.reason]),
      [["before_7", "stale"]]
    );
  });

  await t.test(
    "a missed run does not lose a courtesy note that is still true",
    () => {
      // The scheduler is down for two days. before_7 was due on Sep 3 and the
      // invoice is not overdue until Sep 10, so the note ("Invoice X is due
      // Sep 10") is still accurate and still worth sending — the wording
      // states the due date, not a countdown. Losing it would be the
      // scheduler charging the pilot for its own outage.
      const d = decideReminder({
        ...BASE,
        policy: { beforeDue: [7], onDue: false, afterDue: [] },
        today: "2026-09-05",
      });
      assert.equal(d.action, "send");
      assert.equal(d.rung.key, "before_7");
    }
  );

  await t.test("but it dies the moment the invoice is actually overdue", () => {
    const d = decideReminder({
      ...BASE,
      policy: { beforeDue: [7], onDue: true, afterDue: [] },
      today: "2026-09-11",
    });
    assert.equal(d.action, "consume");
    assert.deepEqual(
      d.supersede.map((s) => [s.rung.key, s.reason]).sort(),
      [
        ["before_7", "stale"],
        ["on_due", "stale"],
      ]
    );
  });

  await t.test("a before-due rung sends on its own day", () => {
    const d = decideReminder({
      ...BASE,
      policy: { beforeDue: [7], onDue: false, afterDue: [] },
      today: "2026-09-03",
    });
    assert.equal(d.action, "send");
    assert.equal(d.rung.key, "before_7");
    assert.deepEqual(d.supersede, []);
  });

  await t.test("nothing is due before the first rung", () => {
    const d = decideReminder({ ...BASE, today: "2026-09-01" });
    assert.equal(d.action, "hold");
    assert.equal(d.reason, "nothing_due");
  });
});

test("a rerun of the same day sends nothing (the idempotency the ledger enforces)", () => {
  // First run sends on_due and consumes the before_7 rung as stale.
  const first = decideReminder({ ...BASE, today: "2026-09-10" });
  assert.equal(first.action, "send");
  const consumed = [first.rung.key, ...first.supersede.map((s) => s.rung.key)];

  // Second run, same day, with those rows now recorded: nothing left.
  const second = decideReminder({ ...BASE, today: "2026-09-10", consumed });
  assert.equal(second.action, "hold");
  assert.equal(second.reason, "nothing_due");

  // And the day after, still nothing — the next rung is after_3 on the 13th.
  const third = decideReminder({ ...BASE, today: "2026-09-11", consumed });
  assert.equal(third.action, "hold");
  assert.equal(third.reason, "nothing_due");

  const fourth = decideReminder({ ...BASE, today: "2026-09-13", consumed });
  assert.equal(fourth.action, "send");
  assert.equal(fourth.rung.key, "after_3");
});

test("a hold never costs a rung", async (t) => {
  await t.test("a manual chase four days ago holds the ladder", () => {
    const d = decideReminder({
      ...BASE,
      today: "2026-10-20",
      lastReminderAt: "2026-10-16T14:00:00Z",
    });
    assert.equal(d.action, "hold");
    assert.equal(d.reason, "recent_reminder");
    // Critically: no supersede list. The 30-day rung is still there tomorrow.
    assert.equal("supersede" in d, false);
  });

  await t.test("and stops holding once the quiet period lapses", () => {
    const d = decideReminder({
      ...BASE,
      today: "2026-10-20",
      lastReminderAt: `2026-10-${20 - QUIET_PERIOD_DAYS}T14:00:00Z`,
    });
    assert.equal(d.action, "send");
  });

  await t.test(
    "a net-7 invoice's before_7 rung does not fire the day the invoice itself is sent",
    () => {
      // Regression: a client on net-7 terms (or net-14 with the 14-day rung,
      // or net-15 with 14) has its largest before-due rung already ripe on
      // day zero — dueOn minus 7 IS the send day when terms are exactly 7.
      // Without sentAt in the quiet period, the pilot's client would get the
      // invoice email and "a quick note that Invoice X is due..." in the
      // same day from the same business.
      const d = decideReminder({
        ...BASE,
        policy: { beforeDue: [7], onDue: false, afterDue: [] },
        dueOn: "2026-09-17",
        today: "2026-09-10",
        sentAt: "2026-09-10T18:00:00Z",
      });
      assert.equal(d.action, "hold");
      assert.equal(d.reason, "recent_send");
    }
  );

  await t.test("and the before_7 rung sends once the quiet period has lapsed", () => {
    const d = decideReminder({
      ...BASE,
      policy: { beforeDue: [7], onDue: false, afterDue: [] },
      dueOn: "2026-09-17",
      today: "2026-09-10",
      sentAt: `2026-09-${10 - QUIET_PERIOD_DAYS}T18:00:00Z`,
    });
    assert.equal(d.action, "send");
    assert.equal(d.rung.key, "before_7");
  });

  await t.test("a link opened yesterday holds", () => {
    const d = decideReminder({
      ...BASE,
      today: "2026-10-20",
      lastViewedAt: "2026-10-19T09:00:00Z",
    });
    assert.equal(d.action, "hold");
    assert.equal(d.reason, "recently_viewed");
  });

  await t.test("a link opened a week ago does not", () => {
    const d = decideReminder({
      ...BASE,
      today: "2026-10-20",
      lastViewedAt: "2026-10-13T09:00:00Z",
    });
    assert.equal(d.action, "send");
    assert.equal(RECENTLY_VIEWED_DAYS < QUIET_PERIOD_DAYS, true);
  });

  await t.test("the pilot's own switch wins over everything", () => {
    const d = decideReminder({ ...BASE, today: "2026-10-20", suppressed: true });
    assert.equal(d.action, "hold");
    assert.equal(d.reason, "suppressed");
  });

  await t.test("no policy and no due date are holds, not errors", () => {
    assert.equal(
      decideReminder({ ...BASE, policy: EMPTY_REMINDER_POLICY }).reason,
      "no_policy"
    );
    assert.equal(decideReminder({ ...BASE, dueOn: null }).reason, "no_due_date");
  });

  await t.test("every hold has a sentence a pilot can act on", () => {
    for (const reason of [
      "suppressed",
      "no_due_date",
      "no_policy",
      "recent_reminder",
      "recent_send",
      "recently_viewed",
      "nothing_due",
    ]) {
      const sentence = describeHold(reason);
      assert.equal(typeof sentence, "string");
      assert.equal(sentence.length > 10, true);
    }
  });
});

test("rung dates cross a DST boundary without drifting", () => {
  // Due 2026-10-30, ladder at 3 days: the 3rd day is 2026-11-02, and the
  // clocks change on 2026-11-01. A local-time implementation reports the 1st.
  const d = decideReminder({
    ...BASE,
    policy: { beforeDue: [], onDue: false, afterDue: [3] },
    dueOn: "2026-10-30",
    today: "2026-11-01",
  });
  assert.equal(d.action, "hold");
  assert.equal(d.reason, "nothing_due");

  const next = decideReminder({
    ...BASE,
    policy: { beforeDue: [], onDue: false, afterDue: [3] },
    dueOn: "2026-10-30",
    today: "2026-11-02",
  });
  assert.equal(next.action, "send");
  assert.equal(next.rung.onDate, "2026-11-02");
});

test("late fees are the pilot's agreed term, computed only when they set one", async (t) => {
  const RATE = normalizeLateFeePolicy({
    bpsPerMonth: 150,
    graceDays: 15,
    noteOnReminders: false,
  });
  const FLAT = normalizeLateFeePolicy({ flatCents: 5000, graceDays: 0 });

  await t.test("no fee configured means no quote, ever", () => {
    assert.equal(hasLateFee(normalizeLateFeePolicy({})), false);
    assert.equal(
      quoteLateFee({
        policy: normalizeLateFeePolicy({}),
        balanceDueCents: 1_400_000,
        dueOn: "2026-09-10",
        today: "2027-09-10",
        monthsAlreadyBilled: 0,
        anyFeeAlreadyRaised: false,
      }),
      null
    );
  });

  await t.test("both kinds set is refused outright rather than picked between", () => {
    const p = normalizeLateFeePolicy({ flatCents: 5000, bpsPerMonth: 150 });
    assert.equal(hasLateFee(p), false);
  });

  await t.test("a rate above the ceiling is not a rate", () => {
    assert.equal(normalizeLateFeePolicy({ bpsPerMonth: 1500 }).bpsPerMonth, null);
    assert.equal(normalizeLateFeePolicy({ bpsPerMonth: 500 }).bpsPerMonth, 500);
    assert.equal(normalizeLateFeePolicy({ bpsPerMonth: -150 }).bpsPerMonth, null);
  });

  await t.test("nothing accrues inside the grace period", () => {
    assert.equal(lateFeeStartDate("2026-09-10", RATE), "2026-09-25");
    const q = quoteLateFee({
      policy: RATE,
      balanceDueCents: 1_400_000,
      dueOn: "2026-09-10",
      today: "2026-09-25",
      monthsAlreadyBilled: 0,
      anyFeeAlreadyRaised: false,
    });
    assert.equal(q, null);
  });

  await t.test("nor before a complete month has passed since it", () => {
    const q = quoteLateFee({
      policy: RATE,
      balanceDueCents: 1_400_000,
      dueOn: "2026-09-10",
      today: "2026-10-24",
      monthsAlreadyBilled: 0,
      anyFeeAlreadyRaised: false,
    });
    assert.equal(q, null);
  });

  await t.test("one complete month at 1.5% of the outstanding balance", () => {
    const q = quoteLateFee({
      policy: RATE,
      balanceDueCents: 1_400_000,
      dueOn: "2026-09-10",
      today: "2026-10-25",
      monthsAlreadyBilled: 0,
      anyFeeAlreadyRaised: false,
    });
    assert.equal(q.amountCents, 21_000);
    assert.equal(q.monthsAccrued, 1);
    assert.equal(q.basis, "bps_per_month");
    assert.equal(q.periodStart, "2026-10-01");
    assert.match(q.explanation, /1\.5% per month/);
  });

  await t.test("months already billed are subtracted, never recomputed", () => {
    // Three months accrued, two already on a fee invoice: bill one.
    const q = quoteLateFee({
      policy: RATE,
      balanceDueCents: 1_400_000,
      dueOn: "2026-09-10",
      today: "2026-12-25",
      monthsAlreadyBilled: 2,
      anyFeeAlreadyRaised: true,
    });
    assert.equal(q.monthsAccrued, 1);
    assert.equal(q.amountCents, 21_000);

    // All of them billed: nothing further.
    assert.equal(
      quoteLateFee({
        policy: RATE,
        balanceDueCents: 1_400_000,
        dueOn: "2026-09-10",
        today: "2026-12-25",
        monthsAlreadyBilled: 3,
        anyFeeAlreadyRaised: true,
      }),
      null
    );
  });

  await t.test("rounding happens once, on the whole amount", () => {
    // 3 months at 1.5% of $100.03 — per-month rounding would drift a cent.
    const q = quoteLateFee({
      policy: RATE,
      balanceDueCents: 10_003,
      dueOn: "2026-09-10",
      today: "2026-12-25",
      monthsAlreadyBilled: 0,
      anyFeeAlreadyRaised: false,
    });
    assert.equal(q.monthsAccrued, 3);
    assert.equal(q.amountCents, Math.round((10_003 * 150 * 3) / 10_000));
  });

  await t.test("a flat fee is once, ever", () => {
    const first = quoteLateFee({
      policy: FLAT,
      balanceDueCents: 1_400_000,
      dueOn: "2026-09-10",
      today: "2026-09-11",
      monthsAlreadyBilled: 0,
      anyFeeAlreadyRaised: false,
    });
    assert.equal(first.amountCents, 5000);
    assert.equal(first.basis, "flat");
    assert.equal(first.monthsAccrued, null);

    assert.equal(
      quoteLateFee({
        policy: FLAT,
        balanceDueCents: 1_400_000,
        dueOn: "2026-09-10",
        today: "2027-09-11",
        monthsAlreadyBilled: 0,
        anyFeeAlreadyRaised: true,
      }),
      null
    );
  });

  await t.test("a flat fee already raised blocks a later rate fee", () => {
    // The pilot switched this client from a $50 flat fee to 1.5%/month after
    // the flat fee had been raised. Accruing from the due date would bill the
    // same overdue period a second time — months_accrued is null on a flat
    // row, so it subtracts nothing.
    assert.equal(
      quoteLateFee({
        policy: RATE,
        balanceDueCents: 1_400_000,
        dueOn: "2026-09-10",
        today: "2026-12-25",
        monthsAlreadyBilled: 0,
        anyFeeAlreadyRaised: true,
        flatFeeAlreadyRaised: true,
      }),
      null
    );

    // A prior RATE fee still only subtracts the months it billed.
    const q = quoteLateFee({
      policy: RATE,
      balanceDueCents: 1_400_000,
      dueOn: "2026-09-10",
      today: "2026-12-25",
      monthsAlreadyBilled: 2,
      anyFeeAlreadyRaised: true,
      flatFeeAlreadyRaised: false,
    });
    assert.equal(q.monthsAccrued, 1);
  });

  await t.test("a zero amount is no agreed fee, not a $0.00 fee", () => {
    // The clients CHECK refuses zero, so this is about the function's own
    // contract: total over untrusted values, failing to NO FEE.
    assert.equal(hasLateFee(normalizeLateFeePolicy({ flatCents: 0 })), false);
    assert.equal(hasLateFee(normalizeLateFeePolicy({ bpsPerMonth: 0 })), false);
    assert.equal(
      lateFeeReminderSentence(
        normalizeLateFeePolicy({ flatCents: 0, noteOnReminders: true })
      ),
      null
    );
    // Grace days are the one place zero is a real answer.
    assert.equal(
      normalizeLateFeePolicy({ flatCents: 5000, graceDays: 0 }).graceDays,
      0
    );
  });

  await t.test("a settled balance owes no fee", () => {
    assert.equal(
      quoteLateFee({
        policy: RATE,
        balanceDueCents: 0,
        dueOn: "2026-09-10",
        today: "2027-09-10",
        monthsAlreadyBilled: 0,
        anyFeeAlreadyRaised: false,
      }),
      null
    );
  });

  await t.test("the fee line names the invoice it relates to", () => {
    const q = quoteLateFee({
      policy: RATE,
      balanceDueCents: 1_400_000,
      dueOn: "2026-09-10",
      today: "2026-10-25",
      monthsAlreadyBilled: 0,
      anyFeeAlreadyRaised: false,
    });
    const line = lateFeeLineDescription(q, "INV-2026-0042", "2026-09-10");
    assert.match(line, /INV-2026-0042/);
    assert.match(line, /as agreed/i);
  });
});

test("reminder wording tells the truth about what was observed", async (t) => {
  const { buildReminderMessage } = await import("../lib/email/invoice-message.ts");
  const BASE = {
    accountName: "Halyard Air LLC",
    clientName: "Meridian Aviation",
    contactName: "Dana Whitfield",
    invoiceNumber: "INV-0042",
    dueOn: "2026-09-10",
    totalCents: 1_400_000,
    balanceDueCents: 1_400_000,
    paymentUrl: null,
    notes: null,
    daysOverdue: 21,
  };

  await t.test("no share link: nothing is said about one", () => {
    const m = buildReminderMessage(BASE);
    assert.doesNotMatch(m.text, /link/i);
    // …and the message is otherwise unchanged from before link-awareness
    // existed, which is what makes this addition safe for every invoice that
    // was only ever emailed.
    assert.equal(m.text, buildReminderMessage({ ...BASE, linkActivity: { kind: "no_link" } }).text);
  });

  await t.test("never opened: offers the attachment instead of accusing", () => {
    const m = buildReminderMessage({ ...BASE, linkActivity: { kind: "never_opened" } });
    assert.match(m.text, /hasn't been opened yet/);
    assert.match(m.text, /in case it didn't reach you/i);
  });

  await t.test("opened: says the LINK was opened, never that a person read it", () => {
    const m = buildReminderMessage({
      ...BASE,
      linkActivity: { kind: "opened", firstViewedAt: "2026-10-12T09:15:00Z" },
    });
    assert.match(m.text, /was opened on Oct 12, 2026/);
    // The stamp records a fetch. Mail scanners fetch. The copy must never
    // claim knowledge of a person — see 20260812200000's header.
    assert.doesNotMatch(m.text, /you (read|saw|viewed|opened)/i);
    assert.doesNotMatch(m.text, /we can see/i);
  });

  await t.test("the agreed fee rides with the courtesy, not with the amount", () => {
    const note = "Per our agreement, a late fee of 1.5% per month applies on balances more than 15 days past their due date.";
    const m = buildReminderMessage({ ...BASE, lateFeeNote: note });
    assert.match(m.text, /Per our agreement/);
    // Below the closing courtesy's position in the body, i.e. after the
    // amount and the payment link — never adjacent to the balance, where it
    // would read as part of what is owed.
    const feeAt = m.text.indexOf("Per our agreement");
    const amountAt = m.text.indexOf("$14,000.00");
    assert.equal(feeAt > amountAt, true);
    assert.equal(feeAt < m.text.indexOf("Thank you"), true);
  });

  await t.test("and is absent unless the caller supplies it", () => {
    assert.doesNotMatch(buildReminderMessage(BASE).text, /late fee/i);
  });
});

test("late-fee copy claims an agreement, never an entitlement", async (t) => {
  await t.test("the pilot is told it is THEIRS", () => {
    const sentence = describeLateFeePolicy(
      normalizeLateFeePolicy({ bpsPerMonth: 150, graceDays: 15 })
    );
    assert.match(sentence, /^Your late fee/);
    assert.match(sentence, /1\.5% per month/);
    assert.match(sentence, /15 days past due/);
  });

  await t.test("nothing reaches a client unless the pilot switched it on", () => {
    const off = normalizeLateFeePolicy({ bpsPerMonth: 150, graceDays: 15 });
    assert.equal(lateFeeReminderSentence(off), null);

    const on = normalizeLateFeePolicy({
      bpsPerMonth: 150,
      graceDays: 15,
      noteOnReminders: true,
    });
    const sentence = lateFeeReminderSentence(on);
    assert.match(sentence, /^Per our agreement/);
    assert.match(sentence, /1\.5% per month/);
    // States the term. Never demands, threatens, or names a running total —
    // an amount here would read as part of the balance due, and the balance
    // due comes from invoice_totals or it does not exist.
    assert.doesNotMatch(sentence, /you must|legally|entitled|owe|now owing|penalt/i);
  });

  await t.test("the note cannot be switched on with nothing to say", () => {
    // Mirrors the database CHECK: the app-side normalizer must not produce a
    // state the column refuses.
    const p = normalizeLateFeePolicy({ noteOnReminders: true });
    assert.equal(lateFeeReminderSentence(p), null);
  });

  await t.test("basis points read as a percent a human recognises", () => {
    assert.equal(formatBps(150), "1.5%");
    assert.equal(formatBps(200), "2%");
    assert.equal(formatBps(125), "1.25%");
  });
});
