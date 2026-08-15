import test from "node:test";
import assert from "node:assert/strict";

const {
  decideReminder,
  consumedRungKeys,
  summarizeRungLedger,
  lastPossibleSendAt,
  outcomeForSendResult,
  MAX_REMINDER_ATTEMPTS,
  MANUAL_RULE_KEY,
  QUIET_PERIOD_DAYS,
} = await import("../lib/reminders/policy.ts");

/**
 * A REMINDER THAT DEFINITELY DID NOT SEND COMES BACK. ONE THAT MAY HAVE SENT
 * DOES NOT.
 *
 * The defect these tests pin: every attempt used to consume its rung, so a
 * mail service down for an hour cost that client that step of the chase for
 * good. The fix cannot simply retry every failure, because the sender returns
 * a failure for two different facts, "nothing was sent" and "the mail service
 * stopped answering, so this may be in your client's inbox", and retrying the
 * second one puts a second chase for one invoice in front of a real client.
 *
 * So the pass below is simulated from the same pure functions
 * lib/reminders/run.ts calls, in the same order, over a ledger that enforces
 * the same partial unique index the database does. What is NOT simulated is
 * anything that would let a mistake pass: the send is stubbed, but which rung
 * is chosen, what is recorded, and what the next run may do with it are all
 * the shipped code.
 */

const DUE_ON = "2026-09-10";
/** No before-due rungs: this is about the chase, which is where money is. */
const LADDER = { beforeDue: [], onDue: false, afterDue: [3, 7, 14, 30] };

/** The mail service, stubbed at the one seam that matters. */
const SENT = (id = "resend-1") => ({ ok: true, id });
const REFUSED = {
  ok: false,
  kind: "refused",
  error: "Nothing was sent. The mail service refused it (403): The domain is not verified.",
};
const TIMED_OUT = {
  ok: false,
  kind: "unknown",
  error:
    "The mail service didn't respond in time, so this may or may not have been sent. Check with your client before sending it again, and mark the invoice's status by hand if it did arrive.",
};

/**
 * pilot.invoice_reminder_sends, and specifically its guard.
 *
 * insert() is the partial unique index invoice_reminder_sends_rung_once as
 * amended by 20260815090000: unique on (rule_key) for every row EXCEPT
 * 'manual' and except 'failed'. It throws the way Postgres would, because a
 * test that let a duplicate through quietly would be testing the harness
 * rather than the product.
 */
function makeLedger(initialRows = []) {
  const rows = [...initialRows];
  return {
    rows,
    insert(row) {
      const indexed = (r) => r.rule_key !== MANUAL_RULE_KEY && r.outcome !== "failed";
      if (indexed(row) && rows.some((r) => indexed(r) && r.rule_key === row.rule_key)) {
        const error = new Error(`duplicate key value violates unique constraint`);
        error.code = "23505";
        throw error;
      }
      rows.push(row);
    },
    of(ruleKey) {
      return rows.filter((r) => r.rule_key === ruleKey);
    },
  };
}

/**
 * One nightly pass over one invoice, shaped exactly like runOneInvoice in
 * lib/reminders/run.ts: decide, record the stale skips, send, record the
 * outcome, record what that send stood in for.
 */
function runPass({ ledger, today, send, policy = LADDER, dueOn = DUE_ON }) {
  const at = `${today}T02:00:00Z`;
  const decision = decideReminder({
    policy,
    dueOn,
    today,
    consumed: consumedRungKeys(ledger.rows),
    lastReminderAt: lastPossibleSendAt(ledger.rows),
    sentAt: null,
    lastViewedAt: null,
    suppressed: false,
  });

  if (decision.action === "hold") return { decision, outcome: null };

  for (const item of decision.supersede) {
    if (item.reason !== "stale") continue;
    ledger.insert({ rule_key: item.rung.key, outcome: "skipped", detail: "stale", created_at: at });
  }
  if (decision.action === "consume") return { decision, outcome: null };

  const result = send(decision.rung);
  const outcome = outcomeForSendResult(result);
  ledger.insert({
    rule_key: decision.rung.key,
    outcome,
    detail: result.ok ? null : result.error,
    provider_message_id: result.ok ? result.id : null,
    created_at: at,
  });
  for (const item of decision.supersede) {
    if (item.reason !== "superseded") continue;
    ledger.insert({ rule_key: item.rung.key, outcome: "skipped", detail: "superseded", created_at: at });
  }
  return { decision, outcome, rung: decision.rung.key };
}

test("a send result becomes the outcome that is true of it", async (t) => {
  await t.test("the three cases, and nothing in between", () => {
    assert.equal(outcomeForSendResult(SENT()), "sent");
    assert.equal(outcomeForSendResult(REFUSED), "failed");
    assert.equal(outcomeForSendResult(TIMED_OUT), "unknown");
  });

  await t.test(
    "a refusal is 'failed' whatever refused it, because nothing left the building",
    () => {
      // Every one of these is a definite non-send: a bad address, no
      // configuration, a connection that never opened, a 2xx with no id.
      for (const error of [
        `"not-an-address" doesn't look like an email address, so nothing was sent.`,
        "Email isn't configured yet, so nothing was sent. RESEND_API_KEY needs setting. You can still download the PDF and send it yourself.",
        "Nothing was sent. The mail service couldn't be reached. Try again, or download the PDF and send it yourself.",
      ]) {
        assert.equal(outcomeForSendResult({ ok: false, kind: "refused", error }), "failed");
      }
    }
  );
});

test("a definite failure is tried again on the next run", async (t) => {
  await t.test("the rung is not consumed, and the same rung goes out tomorrow", () => {
    const ledger = makeLedger();

    // Night one: the domain is not verified, so nothing is sent.
    const first = runPass({ ledger, today: "2026-09-13", send: () => REFUSED });
    assert.equal(first.rung, "after_3");
    assert.equal(first.outcome, "failed");
    // The row is written. A failure is never silence: the pilot's queue and
    // the invoice's own panel both read it.
    assert.equal(ledger.of("after_3").length, 1);
    // …and it does NOT spend the rung.
    assert.deepEqual(consumedRungKeys(ledger.rows), []);

    // Night two: the pilot verified the domain. The same rung goes out.
    const second = runPass({ ledger, today: "2026-09-14", send: () => SENT("resend-2") });
    assert.equal(second.rung, "after_3");
    assert.equal(second.outcome, "sent");
    // Both attempts are on the table. The failure is history, not litter.
    assert.deepEqual(
      ledger.of("after_3").map((r) => r.outcome),
      ["failed", "sent"]
    );
  });

  await t.test("a failed send starts no quiet period", () => {
    // A failure reached nobody, so treating it as "recently chased" would
    // have the scheduler stand down for five days because of its own outage.
    const ledger = makeLedger();
    runPass({ ledger, today: "2026-09-13", send: () => REFUSED });
    assert.equal(lastPossibleSendAt(ledger.rows), null);
  });
});

test("an indeterminate result is never tried again", async (t) => {
  await t.test("the rung is consumed the moment the outcome is unknown", () => {
    const ledger = makeLedger();

    const first = runPass({ ledger, today: "2026-09-13", send: () => TIMED_OUT });
    assert.equal(first.rung, "after_3");
    assert.equal(first.outcome, "unknown");
    assert.deepEqual(consumedRungKeys(ledger.rows), ["after_3"]);

    // Tomorrow, and every day after: nothing more for this rung, ever. A
    // retry here is a SECOND copy of one chase in a real client's inbox, and
    // the mail service has no idempotency key to prevent it.
    for (const today of ["2026-09-14", "2026-09-15", "2026-09-16"]) {
      const again = runPass({ ledger, today, send: () => assert.fail("must not send") });
      assert.equal(again.decision.action, "hold");
    }
    assert.equal(ledger.of("after_3").length, 1);
  });

  await t.test("and it holds the ladder like a send, because it may be one", () => {
    const ledger = makeLedger();
    runPass({ ledger, today: "2026-09-13", send: () => TIMED_OUT });
    assert.equal(lastPossibleSendAt(ledger.rows), "2026-09-13T02:00:00Z");

    // after_7 is ripe on the 17th, four days later, inside the quiet period.
    const inside = runPass({ ledger, today: "2026-09-17", send: () => assert.fail("must not send") });
    assert.equal(inside.decision.action, "hold");
    assert.equal(inside.decision.reason, "recent_reminder");

    // And once the quiet period lapses, the LADDER carries on. Losing one
    // rung is the price of not double-chasing; losing the chase is not.
    const after = runPass({
      ledger,
      today: `2026-09-${13 + QUIET_PERIOD_DAYS}`,
      send: () => SENT("resend-7"),
    });
    assert.equal(after.rung, "after_7");
    assert.equal(after.outcome, "sent");
  });

  await t.test(
    "rows that predate the distinction were re-labelled unknown, and are inert",
    () => {
      // 20260815090000 re-labelled every existing 'failed' row to 'unknown':
      // their kind is genuinely unknowable, so the conservative reading is
      // the only honest one, and behaviour for them is unchanged.
      const ledger = makeLedger([
        {
          rule_key: "after_3",
          outcome: "unknown",
          detail: "Nothing was sent. The mail service refused it (403).",
          created_at: "2026-08-01T02:00:00Z",
        },
      ]);
      assert.deepEqual(consumedRungKeys(ledger.rows), ["after_3"]);
      const pass = runPass({ ledger, today: "2026-09-13", send: () => assert.fail("must not send") });
      assert.equal(pass.decision.action, "hold");
    }
  );
});

test("a rung that succeeds after failing cannot send twice", async (t) => {
  await t.test("the ledger refuses the second recording the way the index does", () => {
    const ledger = makeLedger();
    runPass({ ledger, today: "2026-09-13", send: () => REFUSED });
    runPass({ ledger, today: "2026-09-14", send: () => SENT("resend-2") });

    // Two passes racing on the same night both decide to send; the second
    // insert is what stops the client hearing about it twice. This is the
    // property the partial unique index owns, and it survived the change.
    assert.throws(
      () =>
        ledger.insert({
          rule_key: "after_3",
          outcome: "sent",
          provider_message_id: "resend-3",
          created_at: "2026-09-14T02:01:00Z",
        }),
      (error) => error.code === "23505"
    );
    assert.equal(ledger.of("after_3").filter((r) => r.outcome === "sent").length, 1);
  });

  await t.test("and no later pass ever chooses that rung again", () => {
    const ledger = makeLedger();
    runPass({ ledger, today: "2026-09-13", send: () => REFUSED });
    runPass({ ledger, today: "2026-09-14", send: () => SENT("resend-2") });
    assert.deepEqual(consumedRungKeys(ledger.rows), ["after_3"]);

    // Nineteen more nights. after_7 and after_14 come due in that window and
    // are sent on their own days; after_3 is never revisited.
    for (let day = 15; day <= 30; day += 1) {
      runPass({
        ledger,
        today: `2026-09-${String(day).padStart(2, "0")}`,
        send: (rung) => {
          assert.notEqual(rung.key, "after_3");
          return SENT(`resend-${rung.key}`);
        },
      });
    }
    assert.equal(ledger.of("after_3").filter((r) => r.outcome === "sent").length, 1);
  });
});

test("the retry cap holds", async (t) => {
  await t.test("a permanently bad address is attempted three times and no more", () => {
    const ledger = makeLedger();
    // The client's address is wrong and nobody has noticed. Every night the
    // mail service refuses it in exactly the same way.
    const attempted = [];
    for (let day = 13; day <= 16; day += 1) {
      const pass = runPass({
        ledger,
        today: `2026-09-${day}`,
        send: () => {
          attempted.push(day);
          return REFUSED;
        },
      });
      if (day <= 12 + MAX_REMINDER_ATTEMPTS) assert.equal(pass.rung, "after_3");
    }

    assert.equal(attempted.length, MAX_REMINDER_ATTEMPTS);
    assert.equal(ledger.of("after_3").length, MAX_REMINDER_ATTEMPTS);
    assert.deepEqual(consumedRungKeys(ledger.rows), ["after_3"]);
  });

  await t.test("giving up on one rung does not give up on the invoice", () => {
    const ledger = makeLedger();
    for (let day = 13; day <= 15; day += 1) {
      runPass({ ledger, today: `2026-09-${day}`, send: () => REFUSED });
    }
    // after_7 is due on the 17th and goes out on its own, because the cap is
    // about one rung and not about this client.
    const next = runPass({ ledger, today: "2026-09-17", send: () => SENT("resend-7") });
    assert.equal(next.rung, "after_7");
    assert.equal(next.outcome, "sent");
  });

  await t.test("the cap counts definite failures only", () => {
    // A rung with two failures and one skip is consumed by the skip, not by
    // the count; a rung with two failures alone is still owed.
    const two = [
      { rule_key: "after_3", outcome: "failed", created_at: "2026-09-13T02:00:00Z" },
      { rule_key: "after_3", outcome: "failed", created_at: "2026-09-14T02:00:00Z" },
    ];
    assert.deepEqual(consumedRungKeys(two), []);
    assert.equal(summarizeRungLedger(two).get("after_3").failures, 2);
    assert.deepEqual(
      consumedRungKeys([
        ...two,
        { rule_key: "after_3", outcome: "skipped", created_at: "2026-09-15T02:00:00Z" },
      ]),
      ["after_3"]
    );
  });
});

test("the ledger read tells the panel and the run the same story", async (t) => {
  await t.test("'manual' is a log, not a rung, and never appears as consumed", () => {
    const rows = [
      { rule_key: MANUAL_RULE_KEY, outcome: "sent", created_at: "2026-09-11T09:00:00Z" },
      { rule_key: MANUAL_RULE_KEY, outcome: "sent", created_at: "2026-09-12T09:00:00Z" },
    ];
    assert.deepEqual(consumedRungKeys(rows), []);
    assert.equal(summarizeRungLedger(rows).size, 0);
    // …but a human chase still holds the ladder, which is the whole reason
    // those rows are in this table at all.
    assert.equal(lastPossibleSendAt(rows), "2026-09-12T09:00:00Z");
  });

  await t.test("the latest of what may have gone out, never the latest attempt", () => {
    const rows = [
      { rule_key: "after_3", outcome: "sent", created_at: "2026-09-13T02:00:00Z" },
      { rule_key: "after_7", outcome: "failed", created_at: "2026-09-17T02:00:00Z" },
      { rule_key: "after_7", outcome: "skipped", created_at: "2026-09-18T02:00:00Z" },
    ];
    assert.equal(lastPossibleSendAt(rows), "2026-09-13T02:00:00Z");
  });

  await t.test("a rung mid-retry is distinguishable from one that is finished", () => {
    // What the invoice panel renders on: still trying, versus over. The two
    // read differently to a pilot and must be derivable from the same rows.
    const trying = summarizeRungLedger([
      { rule_key: "after_3", outcome: "failed", created_at: "2026-09-13T02:00:00Z" },
    ]).get("after_3");
    assert.equal(trying.consumed, false);
    assert.equal(trying.failures, 1);

    const finished = summarizeRungLedger(
      Array.from({ length: MAX_REMINDER_ATTEMPTS }, (_, i) => ({
        rule_key: "after_3",
        outcome: "failed",
        created_at: `2026-09-1${3 + i}T02:00:00Z`,
      }))
    ).get("after_3");
    assert.equal(finished.consumed, true);

    const unknown = summarizeRungLedger([
      { rule_key: "after_3", outcome: "unknown", created_at: "2026-09-13T02:00:00Z" },
    ]).get("after_3");
    assert.equal(unknown.consumed, true);
    assert.equal(unknown.failures, 0);
  });
});
