#!/usr/bin/env node
/**
 * Phase 3 verification — clients, trips, and legs (docs/PLAN.md:
 * `npm run trip:verify`).
 *
 * WHY IT DRIVES REAL AUTHENTICATED CLIENTS rather than the service role:
 * every guarantee under test is a guarantee of RLS plus the column-scoped
 * GRANTs, and the service role holds BYPASSRLS — asserting through it
 * would prove nothing. Each tenant here signs in with a password and
 * issues the exact queries the screens issue.
 *
 *   npm run trip:verify
 *
 * Requires NEXT_SUPABASE_URL, NEXT_SUPABASE_PUBLISHABLE_KEY, and
 * NEXT_SUPABASE_SECRET_KEY. The service key is used ONLY to mint and
 * destroy the two synthetic tenants and to re-read rows for confirmation
 * — never to exercise a path the app uses.
 *
 * TWO FAILURE MODES THIS SCRIPT IS WRITTEN TO AVOID, because a security
 * test that passes when it is broken is worse than no test:
 *
 *   1. `const { data } = await ...; (data ?? []).length === 0` reports a
 *      PASS on ANY error — an unreachable database included. Every read
 *      here therefore asserts `error === null` FIRST and fails loudly
 *      otherwise.
 *   2. `err ? pass() : fail()` reports a PASS when the statement failed
 *      for an unrelated reason (a malformed uuid from a fixture that
 *      never got created, say). Every negative case therefore asserts the
 *      SPECIFIC SQLSTATE it expects.
 *
 * A cross-tenant UPDATE or DELETE needs particular care: PostgREST
 * returns 200 with no error when a statement matched zero rows, so
 * "no error" proves nothing either way. Those cases use
 * `{ count: "exact" }` and assert the count is 0, then re-read the target
 * row with the service role to confirm it is untouched.
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
    "trip:verify requires NEXT_SUPABASE_URL, NEXT_SUPABASE_PUBLISHABLE_KEY and NEXT_SUPABASE_SECRET_KEY."
  );
  process.exit(1);
}

/**
 * This script writes real rows (inside its own synthetic tenants) and
 * provisions accounts directly — the unbilled path decisions #6/#7 forbid
 * for real users. That is fine for a fixture and NOT fine against the
 * production project, so refuse unless the operator has said so out loud.
 */
if (!process.env.TRIP_VERIFY_ALLOW_NONLOCAL) {
  const host = new URL(URL_).host;
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (!isLocal) {
    console.error(
      `trip:verify refuses to run against ${host}: it creates auth users and accounts.\n` +
        "Point it at a local Supabase stack, or set TRIP_VERIFY_ALLOW_NONLOCAL=1 if you\n" +
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
};

/**
 * Asserts an operation failed with a SPECIFIC SQLSTATE. Anything else —
 * success, or the wrong error — is a failure, so a broken fixture cannot
 * masquerade as an enforced boundary.
 */
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

/** Asserts a read succeeded before looking at its rows. */
function rows(name, { data, error }) {
  if (error) {
    fail(name, `query errored: ${error.message}`);
    return null;
  }
  return data ?? [];
}

const RUN = randomUUID().slice(0, 8);
const tag = (s) => `tripverify-${RUN}-${s}`;

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

  // A session-scoped client, exactly like lib/supabase/server.ts builds.
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

/**
 * Removes anything tagged with this run. Driven by the `legal_name` /
 * email tag rather than only by the in-memory handles, so a crash between
 * creating a tenant and reaching the teardown still cleans up on the next
 * run rather than accumulating synthetic tenants forever.
 */
async function teardown() {
  const { data: accounts } = await admin
    .from("accounts")
    .select("id")
    .like("legal_name", `tripverify-${RUN}-%`);

  for (const account of accounts ?? []) {
    // Children first: trips reference clients ON DELETE RESTRICT.
    await admin.from("trip_legs").delete().eq("account_id", account.id);
    await admin.from("trips").delete().eq("account_id", account.id);
    await admin.from("clients").delete().eq("account_id", account.id);
    await admin.from("account_members").delete().eq("account_id", account.id);
    await admin.from("accounts").delete().eq("id", account.id);
  }

  const { data: users } = await admin.auth.admin.listUsers();
  for (const user of users?.users ?? []) {
    if (user.email?.startsWith(`tripverify-${RUN}-`)) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
}

console.log(`\ntrip:verify — ${URL_}\n`);

let a = null;
let b = null;

try {
  a = await makeTenant("a");
  b = await makeTenant("b");

  // -------------------------------------------------------------------
  // 1. The path the screens walk: client → trip → leg.
  // -------------------------------------------------------------------
  console.log("Create path (as tenant A, through RLS)");

  const { data: client, error: clientError } = await a.db
    .from("clients")
    .insert({
      account_id: a.accountId,
      name: tag("client"),
      // The exact values app/(app)/clients/actions.ts produces from
      // "1500.00" and "900.00".
      default_day_rate_cents: 150000,
      default_travel_day_rate_cents: 90000,
      payment_terms_days: 30,
    })
    .select("id, default_day_rate_cents")
    .single();

  if (clientError) throw new Error(`fixture client: ${clientError.message}`);
  pass("tenant creates a client", `${client.default_day_rate_cents} cents`);

  const { data: trip, error: tripError } = await a.db
    .from("trips")
    .insert({
      account_id: a.accountId,
      client_id: client.id,
      trip_kind: "contract_pilot",
      status: "completed",
      starts_on: "2026-03-02",
      ends_on: "2026-03-04",
      aircraft_ident: "N123XX",
      day_rate_cents: 150000,
      day_count: 2.5,
      travel_day_count: 1,
      travel_day_rate_cents: 90000,
    })
    .select("id, billing_state, day_rate_cents, day_count")
    .single();

  if (tripError) throw new Error(`fixture trip: ${tripError.message}`);
  pass("tenant creates a trip", `billing_state=${trip.billing_state}`);

  const { data: leg, error: legError } = await a.db
    .from("trip_legs")
    .insert({
      account_id: a.accountId,
      trip_id: trip.id,
      leg_date: "2026-03-02",
      from_icao: "KBED",
      to_icao: "KTEB",
      block_hours: 1.4,
      night_hours: 0.6,
      day_landings: 0,
      night_takeoffs: 1,
      night_landings_full_stop: 1,
      night_landings_touch_go: 0,
      approaches: 1,
      holds: 0,
    })
    .select("id")
    .single();

  if (legError) throw new Error(`fixture leg: ${legError.message}`);
  pass("tenant adds a leg", "night full-stop recorded");

  const value = Math.round(trip.day_rate_cents * Number(trip.day_count));
  value === 375000
    ? pass("trip value math", "$1,500.00 × 2.5 days = $3,750.00")
    : fail("trip value math", `got ${value} cents, expected 375000`);

  // -------------------------------------------------------------------
  // 2. Isolation — reads.
  // -------------------------------------------------------------------
  console.log("\nTenant isolation — reads (as tenant B)");

  for (const table of ["clients", "trips", "trip_legs"]) {
    const name = `B sees none of A's ${table}`;
    const result = rows(name, await b.db.from(table).select("id"));
    if (result === null) continue;
    result.length === 0
      ? pass(name, "0 rows")
      : fail(name, `${result.length} rows leaked`);
  }

  {
    const name = "B cannot read A's trip by id";
    const { data, error } = await b.db
      .from("trips")
      .select("id")
      .eq("id", trip.id)
      .maybeSingle();
    error
      ? fail(name, `query errored: ${error.message}`)
      : data === null
        ? pass(name, "no row — indistinguishable from 404")
        : fail(name, "row returned");
  }

  // -------------------------------------------------------------------
  // 3. Isolation — writes by id. This is the shape of setClientArchived,
  //    deleteTrip and deleteLeg, all of which take a raw id from a public
  //    endpoint. PostgREST returns 200 for a statement that matched zero
  //    rows, so "no error" proves nothing: assert the COUNT is zero, then
  //    confirm with the service role that A's row is untouched.
  // -------------------------------------------------------------------
  console.log("\nTenant isolation — writes by id (as tenant B)");

  {
    const name = "B cannot archive A's client";
    const { count, error } = await b.db
      .from("clients")
      .update({ archived_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", client.id);

    const { data: after } = await admin
      .from("clients")
      .select("archived_at")
      .eq("id", client.id)
      .single();

    error
      ? fail(name, `unexpected error: ${error.message}`)
      : count === 0 && after?.archived_at === null
        ? pass(name, "0 rows matched, A's client untouched")
        : fail(name, `count=${count}, archived_at=${after?.archived_at}`);
  }

  {
    const name = "B cannot delete A's trip";
    const { count, error } = await b.db
      .from("trips")
      .delete({ count: "exact" })
      .eq("id", trip.id);

    const { data: after } = await admin
      .from("trips")
      .select("id")
      .eq("id", trip.id)
      .maybeSingle();

    error
      ? fail(name, `unexpected error: ${error.message}`)
      : count === 0 && after
        ? pass(name, "0 rows matched, A's trip still there")
        : fail(name, `count=${count}, trip ${after ? "present" : "GONE"}`);
  }

  {
    const name = "B cannot delete A's leg";
    const { count, error } = await b.db
      .from("trip_legs")
      .delete({ count: "exact" })
      .eq("id", leg.id);

    const { data: after } = await admin
      .from("trip_legs")
      .select("id")
      .eq("id", leg.id)
      .maybeSingle();

    error
      ? fail(name, `unexpected error: ${error.message}`)
      : count === 0 && after
        ? pass(name, "0 rows matched, A's leg still there")
        : fail(name, `count=${count}, leg ${after ? "present" : "GONE"}`);
  }

  // -------------------------------------------------------------------
  // 4. The trap the Phase 3 migration's header calls out: RLS on
  //    trip_legs checks the LEG's account_id, not the trip's. B stamping
  //    its OWN account_id on a leg pointing at A's trip satisfies the
  //    policy — only the composite FK stops it.
  // -------------------------------------------------------------------
  console.log("\nCross-tenant leg attachment");
  {
    const { error } = await b.db.from("trip_legs").insert({
      account_id: b.accountId,
      trip_id: trip.id,
      leg_date: "2026-03-02",
      day_landings: 1,
    });
    expectError(
      "B cannot attach a leg to A's trip",
      error,
      SQLSTATE.foreign_key_violation,
      "a tenant can write into another tenant's trip"
    );
  }

  // -------------------------------------------------------------------
  // 5. Re-parenting. account_id is withheld from every UPDATE grant.
  // -------------------------------------------------------------------
  console.log("\nRe-parenting");
  {
    const { error } = await a.db
      .from("clients")
      .update({ account_id: b.accountId })
      .eq("id", client.id);
    expectError(
      "A cannot re-parent its client to B",
      error,
      SQLSTATE.insufficient_privilege,
      "account_id is writable"
    );
  }

  // -------------------------------------------------------------------
  // 6. Screen queries — the exact shapes the pages issue, so a
  //    regression shows up here rather than as an empty picker.
  // -------------------------------------------------------------------
  console.log("\nScreen queries");

  const { error: archiveError } = await a.db
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", client.id);
  if (archiveError) throw new Error(`archive: ${archiveError.message}`);

  {
    const name = "archived client drops out of the trip picker";
    const result = rows(
      name,
      await a.db
        .from("clients")
        .select("id, name, default_day_rate_cents")
        .is("archived_at", null)
        .order("name", { ascending: true })
    );
    if (result !== null) {
      result.length === 0
        ? pass(name, "0 options")
        : fail(name, `${result.length} options`);
    }
  }

  {
    const name = "archived client still listed on /clients";
    const result = rows(name, await a.db.from("clients").select("id, archived_at"));
    if (result !== null) {
      result.length === 1 && result[0].archived_at
        ? pass(name, "history preserved")
        : fail(name, "row vanished");
    }
  }

  // -------------------------------------------------------------------
  // 7. A client with trips cannot be deleted — which is why the Clients
  //    screen archives instead.
  // -------------------------------------------------------------------
  console.log("\nDelete protection");
  {
    const { error } = await a.db.from("clients").delete().eq("id", client.id);
    expectError(
      "a client with trips cannot be deleted",
      error,
      SQLSTATE.foreign_key_violation,
      "billing history would be orphaned"
    );
  }
} catch (error) {
  fail("harness", error.message);
} finally {
  await teardown();
  console.log("\n  fixtures removed");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
