#!/usr/bin/env node
/**
 * Phase 9 Layer 1 verification — day types, trip days, and rate cards
 * (docs/PLAN.md: `npm run customisation:verify`).
 *
 * WHY IT DRIVES REAL AUTHENTICATED CLIENTS rather than the service role:
 * every guarantee under test is a guarantee of RLS plus the column-scoped
 * GRANTs, and the service role holds BYPASSRLS — asserting through it
 * would prove nothing. Each tenant here signs in with a password and
 * issues the exact queries the screens issue. Same contract as
 * scripts/trip-verify.mjs; read that file's header for the two failure
 * modes both scripts are written to avoid:
 *
 *   1. `(data ?? []).length === 0` reports PASS on ANY error, an
 *      unreachable database included. Every read asserts `error === null`
 *      before looking at rows.
 *   2. `err ? pass() : fail()` reports PASS when a statement failed for an
 *      unrelated reason. Every negative case asserts the SPECIFIC
 *      SQLSTATE, never merely "an error happened".
 *
 * THE CHECK THAT MATTERS MOST is the last one. A customisation feature
 * that silently re-prices history is worse than no feature, so this script
 * issues an invoice, snapshots its total, then adds day rows to the trip
 * behind it and asserts the total did not move by one cent. Phase 9's
 * whole design — rates snapshotted onto trip_days at capture, and a
 * migration that deliberately backfills nothing — exists to make that
 * true, and this is where it is proven rather than asserted in a comment.
 *
 *   npm run customisation:verify
 *
 * Requires NEXT_SUPABASE_URL, NEXT_SUPABASE_PUBLISHABLE_KEY, and
 * NEXT_SUPABASE_SECRET_KEY. The service key is used ONLY to mint and
 * destroy the two synthetic tenants, to reach columns the app deliberately
 * cannot write (billing_state, invoice status), and to re-read rows for
 * confirmation — never to exercise a path the app uses.
 *
 * All fixtures are synthetic. No live pilot data, ever (docs/PLAN.md).
 */

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_SUPABASE_URL;
const ANON = process.env.NEXT_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.NEXT_SUPABASE_SECRET_KEY;

if (!URL_ || !ANON || !SERVICE) {
  console.error(
    "customisation:verify requires NEXT_SUPABASE_URL, NEXT_SUPABASE_PUBLISHABLE_KEY and NEXT_SUPABASE_SECRET_KEY."
  );
  process.exit(1);
}

/**
 * This script creates auth users and provisions accounts directly — the
 * unbilled path decisions #6/#7 forbid for real users. Fine for a fixture,
 * not fine against production unless the operator says so out loud.
 */
if (!process.env.CUSTOMISATION_VERIFY_ALLOW_NONLOCAL) {
  const host = new URL(URL_).host;
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (!isLocal) {
    console.error(
      `customisation:verify refuses to run against ${host}: it creates auth users and accounts.\n` +
        "Point it at a local Supabase stack, or set CUSTOMISATION_VERIFY_ALLOW_NONLOCAL=1 if you\n" +
        "genuinely mean to run it against a hosted project."
    );
    process.exit(1);
  }
}

const admin = createClient(URL_, SERVICE, {
  db: { schema: "pilot" },
  auth: { persistSession: false },
});

let passed = 0;
let failed = 0;
const pass = (name, detail = "") =>
  (passed++, console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`));
const fail = (name, detail) =>
  (failed++, console.error(`  FAIL  ${name} — ${detail}`));

/** Postgres SQLSTATEs the negative cases must produce, by name. */
const SQLSTATE = {
  insufficient_privilege: "42501",
  foreign_key_violation: "23503",
  check_violation: "23514",
  unique_violation: "23505",
};

function expectError(name, error, expectedCode, detail) {
  if (!error) return fail(name, `operation SUCCEEDED — ${detail}`);
  if (error.code !== expectedCode) {
    return fail(
      name,
      `expected SQLSTATE ${expectedCode}, got ${error.code ?? "none"}: ${error.message}`
    );
  }
  return pass(name, `rejected with ${expectedCode}`);
}

function rows(name, { data, error }) {
  if (error) {
    fail(name, `query errored: ${error.message}`);
    return null;
  }
  return data ?? [];
}

const RUN = randomUUID().slice(0, 8);
const PREFIX = `custverify-${RUN}`;
const tag = (s) => `${PREFIX}-${s}`;

/** ISO date n days after 2026-03-01, so the fixture dates are stable. */
const BASE = new Date(Date.UTC(2026, 2, 1));
const day = (n) => new Date(BASE.getTime() + n * 86400000).toISOString().slice(0, 10);

async function makeTenant(label) {
  const email = `${tag(label)}@example.invalid`;
  const password = `${randomUUID()}Aa1!`;

  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError) throw new Error(`createUser: ${userError.message}`);

  const { data: account, error: accountError } = await admin
    .from("accounts")
    .insert({
      kind: "solo",
      plan: "solo",
      seat_count: 1,
      legal_name: tag(label),
      status: "active",
    })
    .select("id")
    .single();
  if (accountError) throw new Error(`accounts: ${accountError.message}`);

  const { error: memberError } = await admin
    .from("account_members")
    .insert({ account_id: account.id, user_id: created.user.id, role: "owner" });
  if (memberError) throw new Error(`account_members: ${memberError.message}`);

  const session = createClient(URL_, ANON, {
    db: { schema: "pilot" },
    auth: { persistSession: false },
  });
  const { error: signInError } = await session.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);

  return { userId: created.user.id, accountId: account.id, db: session, email };
}

/** A client + an unbilled trip spanning `days` calendar dates. */
async function makeTripFixture(t, label, days = 4) {
  const { data: client, error: clientError } = await t.db
    .from("clients")
    .insert({
      account_id: t.accountId,
      name: tag(`${label}-client`),
      default_day_rate_cents: 120000,
      default_per_diem_cents: 7500,
      payment_terms_days: 30,
    })
    .select("id")
    .single();
  if (clientError) throw new Error(`clients: ${clientError.message}`);

  const { data: trip, error: tripError } = await t.db
    .from("trips")
    .insert({
      account_id: t.accountId,
      client_id: client.id,
      status: "completed",
      starts_on: day(0),
      ends_on: day(days - 1),
      day_rate_cents: 120000,
      day_count: days,
    })
    .select("id")
    .single();
  if (tripError) throw new Error(`trips: ${tripError.message}`);

  return { clientId: client.id, tripId: trip.id };
}

/** The day type with this key, as seen by the tenant. */
async function dayType(t, key) {
  const { data, error } = await t.db
    .from("day_types")
    .select("id, key, label, billable, counts_for_per_diem, default_rate_cents, invoice_line_type, is_builtin")
    .eq("account_id", t.accountId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`day_types(${key}): ${error.message}`);
  if (!data) throw new Error(`day_types(${key}): no row — the seeding trigger did not fire`);
  return data;
}

/**
 * REVIEW FINDING (QA, HIGH): the first version of this function ignored
 * every delete result, so a teardown that could not complete looked
 * identical to one that did — and it could not complete. Deleting a trip
 * whose `billing_state` still read 'invoiced' raised 23514 from
 * `trips_protect_delete_when_billed`, the account delete then failed
 * inside the same cascade, and each run left two synthetic tenants behind
 * FOREVER, silently. 20260807020000 fixed the trigger (it now consults
 * live invoice lines and exempts service_role); this asserts the outcome
 * rather than assuming it, because a leaking fixture script is how a test
 * database becomes untrustworthy.
 */
async function teardown() {
  const { data: accounts } = await admin
    .from("accounts")
    .select("id")
    .like("legal_name", `${PREFIX}-%`);

  const problems = [];
  const step = async (table, promise) => {
    const { error } = await promise;
    if (error) problems.push(`${table}: ${error.message}`);
  };

  for (const account of accounts ?? []) {
    // Children first, and in FK order: invoice_lines reference trips and
    // expenses ON DELETE RESTRICT; trip_days reference day_types the same
    // way, so day_types must go last of the new tables.
    await step("invoice_payments", admin.from("invoice_payments").delete().eq("account_id", account.id));
    await step("invoice_lines", admin.from("invoice_lines").delete().eq("account_id", account.id));
    await step("invoices", admin.from("invoices").delete().eq("account_id", account.id));
    await step("expenses", admin.from("expenses").delete().eq("account_id", account.id));
    await step("trip_days", admin.from("trip_days").delete().eq("account_id", account.id));
    await step("trip_legs", admin.from("trip_legs").delete().eq("account_id", account.id));
    await step("trips", admin.from("trips").delete().eq("account_id", account.id));
    await step("client_rates", admin.from("client_rates").delete().eq("account_id", account.id));
    await step("day_types", admin.from("day_types").delete().eq("account_id", account.id));
    await step("clients", admin.from("clients").delete().eq("account_id", account.id));
    await step("account_members", admin.from("account_members").delete().eq("account_id", account.id));
    await step("accounts", admin.from("accounts").delete().eq("id", account.id));
  }

  // listUsers() is paginated and defaults to 50 per page. Taking the first
  // page only meant a fixture user could survive teardown on any stack with
  // more than fifty users — the leak would be invisible and would grow.
  for (let page = 1; page <= 40; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      problems.push(`listUsers page ${page}: ${error.message}`);
      break;
    }
    const users = data?.users ?? [];
    for (const user of users) {
      if (user.email?.startsWith(`${PREFIX}-`)) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
        if (deleteError) problems.push(`deleteUser ${user.id}: ${deleteError.message}`);
      }
    }
    if (users.length < 200) break;
  }

  // Prove it, rather than trusting the absence of a thrown error.
  const { data: survivors } = await admin
    .from("accounts")
    .select("id")
    .like("legal_name", `${PREFIX}-%`);
  if ((survivors ?? []).length > 0) {
    problems.push(`${survivors.length} synthetic account(s) survived teardown`);
  }

  if (problems.length > 0) {
    fail("teardown left the database dirty", problems.join(" | "));
  } else {
    pass("teardown removed every synthetic row");
  }
}

console.log(`\ncustomisation:verify — ${URL_}\n`);

let a = null;
let b = null;

try {
  a = await makeTenant("a");
  b = await makeTenant("b");

  // -------------------------------------------------------------------
  // 1. Zero state. A brand-new tenant must never meet an empty picker.
  // -------------------------------------------------------------------
  console.log("Zero state — a new account is born with a vocabulary");

  const seeded = rows(
    "seeded day types visible to their owner",
    await a.db
      .from("day_types")
      .select("key, label, billable, counts_for_per_diem, default_rate_cents, invoice_line_type, is_builtin")
      .eq("account_id", a.accountId)
      .order("sort_order")
  );
  if (seeded) {
    const keys = seeded.map((r) => r.key).sort();
    if (keys.join(",") === "flight,off,standby,travel") {
      pass("four day types seeded at account creation", keys.join(", "));
    } else {
      fail("four day types seeded at account creation", `got [${keys.join(", ")}]`);
    }

    if (seeded.every((r) => r.is_builtin === true)) {
      pass("every seeded row is marked is_builtin");
    } else {
      fail("every seeded row is marked is_builtin", JSON.stringify(seeded));
    }

    // A seeded rate would be a number the product invented showing up on a
    // real invoice. Null means "you have not told me yet".
    if (seeded.every((r) => r.default_rate_cents === null)) {
      pass("no seeded rates — the product invents no money");
    } else {
      fail(
        "no seeded rates — the product invents no money",
        `rates: ${seeded.map((r) => r.default_rate_cents).join(", ")}`
      );
    }

    const off = seeded.find((r) => r.key === "off");
    if (off && off.billable === false && off.counts_for_per_diem === false) {
      pass("an off day is not billable and does not draw per diem");
    } else {
      fail("an off day is not billable and does not draw per diem", JSON.stringify(off));
    }
  }

  // -------------------------------------------------------------------
  // 2. Tenancy. A's vocabulary is A's.
  // -------------------------------------------------------------------
  console.log("\nTenancy");

  const bTypesSeenByA = rows(
    "tenant A cannot read tenant B's day types",
    await a.db.from("day_types").select("id").eq("account_id", b.accountId)
  );
  if (bTypesSeenByA) {
    bTypesSeenByA.length === 0
      ? pass("tenant A cannot read tenant B's day types")
      : fail(
          "tenant A cannot read tenant B's day types",
          `${bTypesSeenByA.length} row(s) leaked`
        );
  }

  const aFixture = await makeTripFixture(a, "a");
  const bFlight = await dayType(b, "flight");

  // The composite FK, not the RLS policy, is what stops this: the policy
  // only checks the trip_day's OWN account_id, and A owns that.
  expectError(
    "a day row cannot borrow another tenant's day type",
    (
      await a.db.from("trip_days").insert({
        account_id: a.accountId,
        trip_id: aFixture.tripId,
        day_on: day(0),
        day_type_id: bFlight.id,
        rate_cents: 100000,
      })
    ).error,
    SQLSTATE.foreign_key_violation,
    "tenant A attached tenant B's day type to its own trip"
  );

  const bClientRow = rows(
    "fetch B's client for the cross-tenant rate test",
    await admin.from("clients").select("id").eq("account_id", b.accountId).limit(1)
  );
  const aFlight = await dayType(a, "flight");
  if (bClientRow && bClientRow.length > 0) {
    expectError(
      "a rate override cannot point at another tenant's client",
      (
        await a.db.from("client_rates").insert({
          account_id: a.accountId,
          client_id: bClientRow[0].id,
          day_type_id: aFlight.id,
          rate_cents: 50000,
        })
      ).error,
      SQLSTATE.foreign_key_violation,
      "tenant A wrote a rate against tenant B's client"
    );
  }

  // -------------------------------------------------------------------
  // 3. Column authority. RLS has no column granularity; the GRANTs do.
  // -------------------------------------------------------------------
  console.log("\nColumn authority");

  expectError(
    "is_builtin is not a tenant's to claim",
    (
      await a.db.from("day_types").insert({
        account_id: a.accountId,
        key: "ground_school",
        label: "Ground school",
        is_builtin: true,
      })
    ).error,
    SQLSTATE.insufficient_privilege,
    "a tenant minted a row claiming to be a product default"
  );

  expectError(
    "key is immutable — a pilot renames the label",
    (await a.db.from("day_types").update({ key: "renamed" }).eq("id", aFlight.id)).error,
    SQLSTATE.insufficient_privilege,
    "a tenant moved a day type's stable handle"
  );

  const { error: labelError, count: labelCount } = await a.db
    .from("day_types")
    .update({ label: "Duty day" }, { count: "exact" })
    .eq("id", aFlight.id);
  if (labelError) {
    fail("the label is theirs to change", labelError.message);
  } else if (labelCount !== 1) {
    // PostgREST returns 200 with no error for a zero-row write, so the
    // count is the only thing that proves the update landed.
    fail("the label is theirs to change", `affected ${labelCount} rows, expected 1`);
  } else {
    pass("the label is theirs to change");
  }

  const { data: custom, error: customError } = await a.db
    .from("day_types")
    .insert({
      account_id: a.accountId,
      key: "ground_school",
      label: "Ground school",
      billable: true,
      counts_for_per_diem: true,
      default_rate_cents: 45000,
      invoice_line_type: "other",
      sort_order: 50,
    })
    .select("id, is_builtin")
    .single();
  if (customError) {
    fail("a pilot can invent their own day type", customError.message);
  } else {
    custom.is_builtin === false
      ? pass("a pilot can invent their own day type", "is_builtin defaulted false")
      : fail("a pilot can invent their own day type", "is_builtin was not false");
  }

  expectError(
    "day type keys are unique within an account",
    (
      await a.db.from("day_types").insert({
        account_id: a.accountId,
        key: "ground_school",
        label: "Ground school again",
      })
    ).error,
    SQLSTATE.unique_violation,
    "a duplicate key was accepted"
  );

  // The three contract-term columns on pilot.clients need their own grant:
  // ALTER TABLE ADD COLUMN does not extend an existing column-scoped one.
  const { error: termsError, count: termsCount } = await a.db
    .from("clients")
    .update(
      {
        per_diem_mode: "per_diem",
        minimum_days: 2,
        cancellation_policy_note: "Half rate inside 24 hours.",
      },
      { count: "exact" }
    )
    .eq("id", aFixture.clientId);
  if (termsError) {
    fail("contract terms are writable on a client", termsError.message);
  } else if (termsCount !== 1) {
    fail("contract terms are writable on a client", `affected ${termsCount} rows`);
  } else {
    pass("contract terms are writable on a client");
  }

  // The headline change in 20260807010000, which nothing tested until the
  // review pointed it out: billing_state is trigger-owned. A tenant who can
  // write it can claim to have been paid.
  expectError(
    "billing_state is not a tenant's to write",
    (await a.db.from("trips").update({ billing_state: "paid" }).eq("id", aFixture.tripId)).error,
    SQLSTATE.insufficient_privilege,
    "a tenant rewrote their own billing state"
  );

  // -------------------------------------------------------------------
  // 4. A day row belongs to its trip's dates, at both ends.
  // -------------------------------------------------------------------
  console.log("\nDay rows and trip dates");

  const { error: inRangeError } = await a.db.from("trip_days").insert([
    { account_id: a.accountId, trip_id: aFixture.tripId, day_on: day(0), day_type_id: aFlight.id, rate_cents: 120000 },
    { account_id: a.accountId, trip_id: aFixture.tripId, day_on: day(1), day_type_id: aFlight.id, rate_cents: 120000 },
  ]);
  inRangeError
    ? fail("day rows inside the trip's dates are accepted", inRangeError.message)
    : pass("day rows inside the trip's dates are accepted");

  expectError(
    "a day outside the trip's dates is refused",
    (
      await a.db.from("trip_days").insert({
        account_id: a.accountId,
        trip_id: aFixture.tripId,
        day_on: day(9),
        day_type_id: aFlight.id,
        rate_cents: 120000,
      })
    ).error,
    SQLSTATE.check_violation,
    "an invisible billable day was created outside the grid's range"
  );

  expectError(
    "one row per calendar day per trip",
    (
      await a.db.from("trip_days").insert({
        account_id: a.accountId,
        trip_id: aFixture.tripId,
        day_on: day(0),
        day_type_id: aFlight.id,
        rate_cents: 999,
      })
    ).error,
    SQLSTATE.unique_violation,
    "the same date was typed twice on one trip"
  );

  // The LOWER bound. The first version of this script tested only a date
  // past ends_on and the plan claimed the range was "bounded at both ends"
  // — an assertion in prose is not a test.
  expectError(
    "a day BEFORE the trip's dates is refused",
    (
      await a.db.from("trip_days").insert({
        account_id: a.accountId,
        trip_id: aFixture.tripId,
        day_on: day(-3),
        day_type_id: aFlight.id,
        rate_cents: 120000,
      })
    ).error,
    SQLSTATE.check_violation,
    "a day was created before the trip began"
  );

  expectError(
    "narrowing a trip cannot strand its day rows",
    (await a.db.from("trips").update({ ends_on: day(0) }).eq("id", aFixture.tripId)).error,
    SQLSTATE.check_violation,
    "a day row was left outside the trip, where no screen can see it"
  );

  expectError(
    "moving a trip's START cannot strand its day rows either",
    (await a.db.from("trips").update({ starts_on: day(1) }).eq("id", aFixture.tripId)).error,
    SQLSTATE.check_violation,
    "the guard covered only one end of the range"
  );

  // The column-grant shape that caused a 42501 on every save after the
  // first, when the day grid used a PostgREST .upsert(): an upsert compiles
  // to DO UPDATE SET <every payload column>, and Postgres checks UPDATE
  // privilege on every column in that SET list.
  expectError(
    "a day row cannot be moved to another trip",
    (await a.db.from("trip_days").update({ trip_id: aFixture.tripId }).eq("account_id", a.accountId)).error,
    SQLSTATE.insufficient_privilege,
    "trip_id was writable, so an upsert-shaped write would silently work"
  );

  // -------------------------------------------------------------------
  // 4b. A day may be worked in part (20260807020000). Without this column
  // a 2.5-day trip could not be represented at all, and converting one to
  // day rows dropped half a day of billing.
  // -------------------------------------------------------------------
  console.log("\nPart days");

  const { error: halfDayError, count: halfDayCount } = await a.db
    .from("trip_days")
    .update({ quantity: 0.5 }, { count: "exact" })
    .eq("account_id", a.accountId)
    .eq("trip_id", aFixture.tripId)
    .eq("day_on", day(1));
  if (halfDayError) {
    fail("a day can be half a day", halfDayError.message);
  } else if (halfDayCount !== 1) {
    fail("a day can be half a day", `affected ${halfDayCount} rows`);
  } else {
    pass("a day can be half a day");
  }

  expectError(
    "a day cannot be worth zero days",
    (
      await a.db
        .from("trip_days")
        .update({ quantity: 0 })
        .eq("account_id", a.accountId)
        .eq("trip_id", aFixture.tripId)
        .eq("day_on", day(1))
    ).error,
    SQLSTATE.check_violation,
    "a zero-quantity day row would bill nothing while looking billable"
  );

  expectError(
    "a calendar day cannot be worth more than a day",
    (
      await a.db
        .from("trip_days")
        .update({ quantity: 1.5 })
        .eq("account_id", a.accountId)
        .eq("trip_id", aFixture.tripId)
        .eq("day_on", day(1))
    ).error,
    SQLSTATE.check_violation,
    "quantity is a statement about time; rate is the statement about money"
  );

  // 20260807020000 mirrors the app's parseTenth(..., { max: 999 }) into a
  // CHECK, because PostgREST is directly addressable and a crafted PATCH
  // stored 9999.9 — which then inflates a real invoice line.
  expectError(
    "a contract minimum is bounded at the database",
    (await a.db.from("clients").update({ minimum_days: 9999.9 }).eq("id", aFixture.clientId)).error,
    SQLSTATE.check_violation,
    "a tenant stored a 9,999-day minimum the app would have rejected"
  );

  // -------------------------------------------------------------------
  // 5. Archiving, not deleting. Three years of trips must keep rendering.
  // -------------------------------------------------------------------
  console.log("\nArchiving preserves history");

  // REVIEW FINDING (QA, HIGH): deleting a built-in succeeded, because the
  // ON DELETE RESTRICT from trip_days only protects a type already IN USE
  // — and this phase deliberately writes no trip_days rows, so for every
  // existing tenant no built-in was referenced by anything. Deleting
  // "Flight day" left the trip grid's zero-state seed with nothing to seed
  // from, permanently: the seeding trigger is AFTER INSERT on accounts, so
  // it never comes back. 20260807020000 blocks it at the database.
  //
  // Note the SQLSTATE: 23514 from the trigger, not 23503 from the FK. A
  // BEFORE DELETE trigger fires before referential integrity is checked,
  // so the built-in guard is what answers first even for a type in use.
  expectError(
    "a built-in day type cannot be deleted",
    (await a.db.from("day_types").delete().eq("id", aFlight.id)).error,
    SQLSTATE.check_violation,
    "the starting vocabulary could be destroyed with no way to restore it"
  );

  // A pilot's OWN type, in use, still hits the FK — the protection that
  // keeps three years of trips rendering.
  const { data: usedCustom } = await a.db
    .from("day_types")
    .select("id")
    .eq("account_id", a.accountId)
    .eq("key", "ground_school")
    .maybeSingle();
  if (usedCustom) {
    await a.db.from("trip_days").insert({
      account_id: a.accountId,
      trip_id: aFixture.tripId,
      day_on: day(2),
      day_type_id: usedCustom.id,
      rate_cents: 45000,
    });
    expectError(
      "a day type in use cannot be deleted",
      (await a.db.from("day_types").delete().eq("id", usedCustom.id)).error,
      SQLSTATE.foreign_key_violation,
      "deleting a day type would have taken billable days with it"
    );
  }

  // An unused type a pilot invented and changed their mind about IS theirs
  // to delete — archiving is the rule for history, not a cage.
  const { data: throwaway } = await a.db
    .from("day_types")
    .insert({ account_id: a.accountId, key: "throwaway", label: "Throwaway" })
    .select("id")
    .single();
  if (throwaway) {
    const { error: dropError, count: dropCount } = await a.db
      .from("day_types")
      .delete({ count: "exact" })
      .eq("id", throwaway.id);
    !dropError && dropCount === 1
      ? pass("an unused day type a pilot invented can be deleted")
      : fail(
          "an unused day type a pilot invented can be deleted",
          dropError ? dropError.message : `affected ${dropCount} rows`
        );
  }

  const { error: archiveError } = await a.db
    .from("day_types")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", aFlight.id);
  if (archiveError) {
    fail("a day type can be archived", archiveError.message);
  } else {
    pass("a day type can be archived");

    const stillResolves = rows(
      "archived day types still resolve on existing trips",
      await a.db
        .from("trip_days")
        .select("day_on, rate_cents, day_types(label, archived_at)")
        .eq("trip_id", aFixture.tripId)
    );
    if (stillResolves) {
      const named = stillResolves.filter((r) => r.day_types?.label);
      named.length === stillResolves.length && stillResolves.length > 0
        ? pass(
            "archived day types still resolve on existing trips",
            `${named.length} day row(s) still name their type`
          )
        : fail(
            "archived day types still resolve on existing trips",
            `${named.length}/${stillResolves.length} resolved`
          );
    }

    // The picker filter the screens use.
    const pickable = rows(
      "an archived type drops out of the picker",
      await a.db
        .from("day_types")
        .select("key")
        .eq("account_id", a.accountId)
        .is("archived_at", null)
    );
    if (pickable) {
      pickable.some((r) => r.key === "flight")
        ? fail("an archived type drops out of the picker", "flight is still offered")
        : pass("an archived type drops out of the picker");
    }
  }

  // -------------------------------------------------------------------
  // 6. THE MONEY REGRESSION. The check this whole layer is gated on.
  //
  // An issued invoice snapshotted its quantities and unit amounts. Nothing
  // added afterwards — a day row, a rate change, a new day type — may move
  // it by one cent. If this fails, the feature is worse than not shipping.
  // -------------------------------------------------------------------
  console.log("\nMoney regression — history does not re-price");

  const billed = await makeTripFixture(a, "billed", 3);

  // Deliberately NOT the flight type: section 5 archived that one, and a
  // money-regression fixture built on an archived day type is testing a
  // state no real trip is in. (The first version of this script did exactly
  // that — harmless, but not what the section claims to prove.)
  const aTravel = await dayType(a, "travel");

  const { data: invoice, error: invoiceError } = await a.db
    .from("invoices")
    .insert({
      account_id: a.accountId,
      client_id: billed.clientId,
      tax_rate_bps: 0,
    })
    .select("id")
    .single();
  if (invoiceError) throw new Error(`invoices: ${invoiceError.message}`);

  const { error: lineError } = await a.db.from("invoice_lines").insert({
    account_id: a.accountId,
    invoice_id: invoice.id,
    line_type: "flight_day",
    description: "Flight days",
    quantity: 3,
    unit_amount_cents: 120000,
    taxable: true,
    trip_id: billed.tripId,
    sort_order: 0,
  });
  if (lineError) throw new Error(`invoice_lines: ${lineError.message}`);

  // THE DRAFT WINDOW. REVIEW FINDING (QA, CRITICAL): both freezes
  // originally keyed on trips.billing_state, and invoices_sync_trip_billing_
  // state only fires on an invoice STATUS CHANGE — so a trip sitting on a
  // DRAFT invoice still read 'unbilled' and its days stayed editable through
  // the whole draft window, which is exactly when a pilot goes back to fix a
  // day. Draft, spot the error, fix the grid, send: the client then holds a
  // document that does not match the trip, and the trip freezes in its new
  // state so it can never be reconciled. 20260807020000 re-keys both guards
  // onto whether a live invoice line references the trip.
  //
  // The invoice is still status='draft' at this point. That is the test.
  const draftFreeze = await a.db.from("trip_days").insert({
    account_id: a.accountId,
    trip_id: billed.tripId,
    day_on: day(0),
    day_type_id: aTravel.id,
    rate_cents: 500000,
  });
  expectError(
    "a trip on a DRAFT invoice is already frozen",
    draftFreeze.error,
    SQLSTATE.check_violation,
    "the draft window let the trip and the invoice diverge"
  );
  if (draftFreeze.error && !/billed on/i.test(draftFreeze.error.message)) {
    fail(
      "the freeze names the invoice",
      `message was "${draftFreeze.error.message}" — a pilot cannot act on that`
    );
  } else if (draftFreeze.error) {
    pass("the freeze names the invoice", draftFreeze.error.message);
  }

  // Issue it. Status moves through the app's own path; the number is
  // assigned by invoices_assign_number_on_issue.
  //
  // This line is also the gate on the CRITICAL the security review found:
  // invoices_sync_trip_billing_state is a trigger that writes
  // pilot.trips.billing_state, and 20260807010000 revoked that column from
  // `authenticated`. The trigger runs with the CALLER's privileges unless it
  // is SECURITY DEFINER, so every send of a trip-linked invoice failed with
  // 42501 until 20260807020000 made it DEFINER. Issuing here, as the tenant
  // rather than as the service role, is what makes this script able to
  // catch that — and it would have, had it been re-run.
  const { error: issueError } = await a.db
    .from("invoices")
    .update({ status: "sent" })
    .eq("id", invoice.id);
  if (issueError) {
    fail("a tenant can send an invoice drafted from a trip", issueError.message);
    throw new Error(`issue invoice: ${issueError.message}`);
  }
  pass("a tenant can send an invoice drafted from a trip");

  const syncedRows = rows(
    "sending an invoice syncs the trip's billing state",
    await a.db.from("trips").select("billing_state").eq("id", billed.tripId)
  );
  if (syncedRows) {
    syncedRows[0]?.billing_state === "invoiced"
      ? pass("sending an invoice syncs the trip's billing state")
      : fail(
          "sending an invoice syncs the trip's billing state",
          `billing_state is "${syncedRows[0]?.billing_state}" — the trigger did not write`
        );
  }

  const beforeRows = rows(
    "read the issued invoice's total",
    await a.db
      .from("invoice_totals")
      .select("total_cents, subtotal_cents, tax_cents")
      .eq("invoice_id", invoice.id)
  );
  const before = beforeRows?.[0];
  if (!before) {
    fail("read the issued invoice's total", "no totals row");
  } else {
    // Once issued, the trip's days are settled for the tenant too.
    expectError(
      "an invoiced trip's days are frozen",
      (
        await a.db.from("trip_days").insert({
          account_id: a.accountId,
          trip_id: billed.tripId,
          day_on: day(0),
          day_type_id: aTravel.id,
          rate_cents: 500000,
        })
      ).error,
      SQLSTATE.check_violation,
      "a pilot edited the days behind an invoice their client is holding"
    );

    // Now force day rows in behind the freeze, as the service role — which
    // 20260807020000 exempts, the same way every other protective trigger in
    // this schema already did. This is the adversarial version of the
    // question: if day rows DID exist on an invoiced trip, by a future
    // import or a support action, is the invoice still worth what it says?
    //
    // REVIEW FINDING (QA, HIGH): the first version of this block read
    //
    //     if (forcedError && forcedError.code !== check_violation) fail(...)
    //
    // which SWALLOWED the very error it was provoking — the trigger had no
    // service_role exemption then, so the insert always raised 23514, the
    // rows never landed, and the "an issued invoice does not move"
    // assertion below compared two reads of an untouched invoice. It could
    // not fail. The script's own header calls this the check that matters
    // most, and it was a no-op. Assert the rows LANDED.
    const forced = await admin
      .from("trip_days")
      .insert(
        [
          { account_id: a.accountId, trip_id: billed.tripId, day_on: day(0), day_type_id: aTravel.id, rate_cents: 500000 },
          { account_id: a.accountId, trip_id: billed.tripId, day_on: day(1), day_type_id: aTravel.id, rate_cents: 500000 },
          { account_id: a.accountId, trip_id: billed.tripId, day_on: day(2), day_type_id: aTravel.id, rate_cents: 500000 },
        ],
        { count: "exact" }
      );
    if (forced.error) {
      fail("service_role can reach past the freeze", forced.error.message);
    } else if (forced.count !== 3) {
      fail("service_role can reach past the freeze", `${forced.count} of 3 rows landed`);
    } else {
      pass("service_role can reach past the freeze", "3 day rows forced onto the billed trip");
    }

    // And move every rate the resolution path would have consulted, so the
    // next assertion is answering a real question rather than an empty one.
    await admin
      .from("day_types")
      .update({ default_rate_cents: 999999 })
      .eq("account_id", a.accountId);
    await admin.from("client_rates").insert({
      account_id: a.accountId,
      client_id: billed.clientId,
      day_type_id: aTravel.id,
      rate_cents: 999999,
    });

    const afterRows = rows(
      "re-read the issued invoice's total",
      await a.db
        .from("invoice_totals")
        .select("total_cents, subtotal_cents, tax_cents")
        .eq("invoice_id", invoice.id)
    );
    const after = afterRows?.[0];
    if (!after) {
      fail("re-read the issued invoice's total", "no totals row");
    } else if (
      after.total_cents === before.total_cents &&
      after.subtotal_cents === before.subtotal_cents &&
      after.tax_cents === before.tax_cents
    ) {
      pass(
        "an issued invoice does not move",
        `${before.total_cents} cents before and after day rows and a 8x rate change`
      );
    } else {
      fail(
        "an issued invoice does not move",
        `${before.total_cents} -> ${after.total_cents} cents`
      );
    }
  }

  // -------------------------------------------------------------------
  // 7. The snapshot, stated directly: a captured day keeps its own rate.
  // -------------------------------------------------------------------
  console.log("\nRates snapshot at capture");

  const capturedRows = rows(
    "a captured day keeps the rate it was captured at",
    await admin
      .from("trip_days")
      .select("rate_cents")
      .eq("trip_id", aFixture.tripId)
      .eq("day_on", day(0))
  );
  const captured = capturedRows?.[0];
  if (!captured) {
    fail("a captured day keeps the rate it was captured at", "no day row");
  } else if (captured.rate_cents === 120000) {
    pass(
      "a captured day keeps the rate it was captured at",
      "day_types.default_rate_cents moved to 999999; the day row did not"
    );
  } else {
    fail(
      "a captured day keeps the rate it was captured at",
      `expected 120000, got ${captured.rate_cents}`
    );
  }

  // -------------------------------------------------------------------
  // 8. Preferences are per account, not global. (The claim the whole
  //    customisation layer rests on.)
  // -------------------------------------------------------------------
  console.log("\nPer-tenant, not global");

  const bAfterAEdits = rows(
    "tenant B's vocabulary is untouched by tenant A's edits",
    await b.db
      .from("day_types")
      .select("key, label, default_rate_cents, archived_at")
      .eq("account_id", b.accountId)
      .eq("key", "flight")
  );
  const bFlightAfter = bAfterAEdits?.[0];
  if (!bFlightAfter) {
    fail("tenant B's vocabulary is untouched by tenant A's edits", "no flight row for B");
  } else if (
    bFlightAfter.label === "Flight day" &&
    bFlightAfter.default_rate_cents === null &&
    bFlightAfter.archived_at === null
  ) {
    pass("tenant B's vocabulary is untouched by tenant A's edits");
  } else {
    fail(
      "tenant B's vocabulary is untouched by tenant A's edits",
      JSON.stringify(bFlightAfter)
    );
  }
} catch (err) {
  fail("fixture setup", err instanceof Error ? err.message : String(err));
} finally {
  try {
    await teardown();
  } catch (err) {
    console.error(`  teardown failed: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
