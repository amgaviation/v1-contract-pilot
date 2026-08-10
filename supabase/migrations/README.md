# Migrations

Ordinary `supabase/migrations/YYYYMMDDHHMMSS_name.sql` files, applied in filename order. Everything
below is a fact about this project that costs someone an hour if they discover it the hard way.

## The recorded version does not match the filename

The `supabase_migrations.schema_migrations` table in the live project records versions that are
**close to, but not equal to, the timestamps in these filenames**. For example:

| File | Recorded version |
|---|---|
| `20260811010000_invoice_public_link_amount.sql` | `20260810205403` |
| `20260811020000_ipc_rotation_expiry.sql` | `20260810205550` |

This is not drift or damage. Migrations here have been applied through the Supabase MCP
`apply_migration` tool, which stamps its own version from the server clock at the moment of
application rather than reading the one in the filename. Every migration in this project's history
has been recorded that way, so the pattern is consistent, and **relative order is preserved** — the
recorded versions sort in the same sequence the files do.

**The consequence to know about.** A future `supabase db push` from this repo will not find these
filename timestamps in the migration table and will offer to apply them again. That is expected, and
it is safe *for the ones written as `create or replace`* — which is most of them, deliberately. It is
NOT automatically safe for a migration that does anything non-idempotent. Before any `db push`
against a project that already has history, reconcile the two lists first rather than letting the
tool decide.

If someone wants to fix this properly, the fix is to stop mixing the two application paths: either
push everything through the CLI, or keep applying through the tool and accept that the filename is
documentation while the recorded version is the record. Do not "repair" the table by hand.

## The revoke trap

`revoke <priv> on <table>` drops **every column-level privilege** on that table, and the `grant` that
follows restores only what it names. This has broken this repo more than four times — each time by
someone writing a revoke/grant pair that looked complete and silently narrowed a column list
established three migrations earlier.

**New grants are ADDED. Nothing is ever re-granted after a revoke.** If you believe you need a revoke,
read every prior grant on that table first and be able to state what each one gave.

## `create or replace view` matches columns positionally

It may only **append** at the end. Inserting a column in the middle raises
`cannot change name of view column X to Y`, because Postgres pairs the new column list against the
old one by position, not by name. Column order in a view is an interface.

## Row locks need a privilege the table may not grant

`select ... for update` and `for share` require UPDATE or DELETE privilege. A table granted only
SELECT and INSERT — several here are, on purpose — cannot be locked, and the attempt raises 42501 at
runtime rather than at deploy time. Where concurrency needs controlling on such a table, a unique
index is the tool.

## Verifying migrations locally

`scripts/lib/verify-bootstrap.sql` is the Supabase-shaped scaffold every database-backed verify
script replays before these migrations. See the header of that file for what it is and is not, and
`.github/workflows/ci.yml`'s `database` job for how the suites are run.
