#!/usr/bin/env node
/**
 * account-lifecycle:verify — every tenant table has a decided fate.
 *
 * WHAT THIS CATCHES, and why it is worth a script rather than a code review.
 * pilot.purge_business_data (20260818090000_account_lifecycle.sql) names the
 * tables a hold expiry deletes from. A table added to the schema after that
 * migration is, by omission, RETAINED — it survives a purge because nobody
 * came back and added a line. Retaining is the safe direction, which is
 * exactly the problem: the mistake is invisible. Nothing breaks, no test
 * goes red, and a table that should have been purged quietly is not, for
 * years.
 *
 * So this asserts a PARTITION: every table in the `pilot` schema is either
 * purged by that function, or named below as deliberately retained, and
 * never neither. Adding a table forces the author to decide which, in a
 * file that says why.
 *
 * STATIC, ON PURPOSE. It reads the migration SQL rather than a live
 * database, so it runs in CI with no Postgres, on a laptop with no
 * credentials, and before the migration has ever been applied anywhere.
 * The thing being checked is the completeness of a list in a file, which is
 * a property of the file.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const LIFECYCLE = "20260818090000_account_lifecycle.sql";
// The delete list moved one function inward when 20260818200000 split the
// owner check off the deletes (expire_hold runs with no session and could
// never satisfy an owner check). It is still written in exactly ONE place;
// this is where that place now is.
const PURGE_SOURCE = "20260818200000_monthly_hold.sql";
const PURGE_FN = "purge_business_data_rows";

/**
 * Tables a purge deliberately leaves alone, each with the reason. The
 * reason is not decoration: it is the thing a future reader needs in order
 * to tell a deliberate retention from a forgotten one, which is the whole
 * failure this script exists to prevent.
 */
const RETAINED = {
  // ── The airman's own records. Never destroyed by a billing event. ──
  logbook_entries: "14 CFR 61.51 flight record. Never purged by a lapse.",
  logbook_import_batches: "Provenance for logbook entries that are kept.",
  logbook_source_files: "The uploaded logbook file behind a kept import.",
  aircraft: "Groups kept logbook entries; time-in-type depends on it.",
  documents: "Medical, certificates, passport, insurance. Airman records.",
  document_shares: "Revocable client links to kept documents.",
  document_share_items: "Which kept documents a share exposes.",
  // True as of 20260821120000, not merely aspirational: the FK to
  // pilot.clients is ON DELETE SET NULL (client_id) and the row carries a
  // denormalized operator_name, so a purge leaves the qualification in place,
  // detached and still naming the operator it was held under.
  operator_qualifications: "Standing under an operator's 135 certificate.",
  currency_snapshots: "Computed from the kept logbook.",

  // ── Account identity and configuration. A purge empties the product; ──
  // ── it does not un-configure it.                                     ──
  accounts: "The tenant row itself.",
  account_members: "Who may sign in. Not business data.",
  account_preferences: "Theme, nav layout. Settings, not records.",
  custom_options: "Renamed expense/trip/document categories.",
  day_types: "The vocabulary trips are priced in.",
  mileage_rates: "Per-tax-year IRS rates the pilot entered.",

  // ── Number sequences. See the migration header: re-minting an invoice ──
  // ── number already issued to a client is unfixable once it happens.   ──
  invoice_number_sequences: "Counter must keep counting across a purge.",
  estimate_number_sequences: "Counter must keep counting across a purge.",

  // ── Not tenant-scoped at all. ──
  stripe_events:
    "Webhook idempotency ledger, keyed on Stripe's event id. Deleting it " +
    "would let a replayed delivery re-apply as new.",
  sample_connect_accounts: "Cascades from auth.users; a developer demo.",
  connect_oauth_states: "Ephemeral OAuth nonces; expire on their own.",
};

function fail(lines) {
  console.error("account-lifecycle:verify FAILED\n");
  for (const line of lines) console.error("  " + line);
  console.error("");
  process.exit(1);
}

// ── Every table the pilot schema declares ────────────────────────────────
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const declared = new Set();
for (const file of files) {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  for (const m of sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?pilot\.(\w+)/gi
  )) {
    declared.add(m[1]);
  }
}

if (declared.size === 0) {
  fail(["Found no `create table pilot.*` at all — the parse is wrong."]);
}

// ── Every table pilot.purge_business_data deletes from ───────────────────
const lifecycleSql = readFileSync(join(MIGRATIONS, LIFECYCLE), "utf8");
const purgeSql = readFileSync(join(MIGRATIONS, PURGE_SOURCE), "utf8");

/** Body of one `create or replace function pilot.<name>` block. */
function functionBody(name, source = lifecycleSql, label = LIFECYCLE) {
  const start = source.indexOf(`function pilot.${name}(`);
  if (start === -1) fail([`Could not find pilot.${name} in ${label}.`]);
  const open = source.indexOf("as $$", start);
  const close = source.indexOf("$$;", open);
  if (open === -1 || close === -1) {
    fail([`Could not read the body of pilot.${name}.`]);
  }
  return source.slice(open, close);
}

function deletedTables(name, source, label) {
  const out = new Set();
  for (const m of functionBody(name, source, label).matchAll(
    /delete\s+from\s+pilot\.(\w+)/gi
  )) {
    out.add(m[1]);
  }
  return out;
}

const purged = deletedTables(PURGE_FN, purgeSql, PURGE_SOURCE);

// A rename or a move that left this list empty would make every check below
// vacuously pass — the failure mode of a completeness check is that it stops
// finding the thing it is completing. Refuse an empty parse outright.
if (purged.size === 0) {
  fail([
    `Parsed ZERO deletes out of pilot.${PURGE_FN} in ${PURGE_SOURCE}.`,
    `Every check in this script would pass vacuously. The function was`,
    `probably renamed or moved; point PURGE_FN/PURGE_SOURCE at its new home.`,
  ]);
}
const resetOnly = deletedTables("reset_account_data");

const problems = [];

// 1. THE PARTITION. Every declared table is purged or deliberately retained.
const unclassified = [...declared]
  .filter((t) => !purged.has(t) && !RETAINED[t])
  .sort();

if (unclassified.length > 0) {
  problems.push(
    `${unclassified.length} table(s) in the pilot schema are neither purged by`,
    `pilot.purge_business_data nor listed as RETAINED in this script:`,
    ...unclassified.map((t) => `    pilot.${t}`),
    ``,
    `Decide which each one is. If a hold expiry should delete it, add it to`,
    `the function in ${LIFECYCLE}. If it must survive — an airman record, a`,
    `setting, a number sequence — add it to RETAINED here WITH THE REASON.`,
    `Leaving it out means it silently survives, which is the bug this checks.`
  );
}

// 2. No table is claimed by both sides.
const both = [...purged].filter((t) => RETAINED[t]).sort();
if (both.length > 0) {
  problems.push(
    `Table(s) both purged and listed as retained — the two disagree:`,
    ...both.map((t) => `    pilot.${t}`)
  );
}

// 3. The purge never touches an airman record. This is the product promise
//    in docs/PRICING.md §5 expressed as a test: a hold expiry may cost a
//    pilot their commercial records and may never cost them their logbook.
const AIRMAN = [
  "logbook_entries",
  "logbook_import_batches",
  "logbook_source_files",
  "aircraft",
  "documents",
  "document_shares",
  "document_share_items",
  "operator_qualifications",
  "currency_snapshots",
];
const airmanPurged = AIRMAN.filter((t) => purged.has(t));
if (airmanPurged.length > 0) {
  problems.push(
    `pilot.purge_business_data deletes AIRMAN records, which it must never do:`,
    ...airmanPurged.map((t) => `    pilot.${t}`),
    `A hold expiry is a billing event. It may not destroy a 14 CFR 61.51`,
    `record or a document wallet. Move these to reset_account_data, which is`,
    `only ever reached by an explicit typed confirmation from the owner.`
  );
}

// 4. The number sequences survive BOTH paths. A re-minted invoice number is
//    unfixable once two documents share it.
for (const seq of ["invoice_number_sequences", "estimate_number_sequences"]) {
  if (purged.has(seq) || resetOnly.has(seq)) {
    problems.push(
      `pilot.${seq} is deleted by a lifecycle function. It must never be:`,
      `resetting the counter lets a future document re-mint a number already`,
      `issued to a client, which cannot be corrected after the fact.`
    );
  }
}

// 5. reset_account_data must be a superset of the purge — it is "everything
//    the purge does, plus the airman records", and a drift between them
//    would leave a reset account holding rows the pilot asked to be rid of.
const resetCovers = new Set([...purged, ...resetOnly]);
const missedByReset = AIRMAN.filter((t) => !resetCovers.has(t)).sort();
if (missedByReset.length > 0) {
  problems.push(
    `pilot.reset_account_data leaves airman record(s) behind:`,
    ...missedByReset.map((t) => `    pilot.${t}`),
    `A reset is the pilot asking to start over; it must clear these too.`
  );
}

if (problems.length > 0) fail(problems);

console.log(
  `account-lifecycle:verify passed — ${declared.size} pilot tables, ` +
    `${purged.size} purged on hold expiry, ${Object.keys(RETAINED).length} ` +
    `deliberately retained, ${AIRMAN.length} airman records provably ` +
    `untouched by a billing event.`
);
