# How to change things safely in the SQL Editor

This is the one place the safety rules live. Every domain file in this folder
(`01-tenancy-auth.md` through `07-documents-sharing-crew.md`) links back here
instead of repeating it, and only adds a note where a specific table needs
something *beyond* what's on this page.

## The fact everything else here follows from

Supabase gives every project several Postgres roles. The three the app
actually runs as — `anon`, `authenticated`, `service_role` — are the ones
every RLS policy and every grant in this schema is written for. The
Dashboard's **SQL Editor is not one of those three roles.** It runs queries
as `postgres` (Supabase's admin role) via `dashboard_user`, an administrative
connection meant for "running commands via the Supabase UI" — not the role
PostgREST hands out to a signed-in pilot or an anonymous request
([Supabase's own Postgres Roles doc](https://supabase.com/docs/guides/database/postgres/roles)).

Row Level Security in Postgres does not constrain a table's owner unless a
table has been explicitly marked `FORCE ROW LEVEL SECURITY` — none in this
schema are. Since the migrations that created every `pilot` table were
applied through an admin connection, that connection owns them. Put plainly:

**Every RLS policy, every column-scoped grant, and every "no direct
INSERT/UPDATE, written only through this function" note in this folder is a
restriction on the app. None of it restricts you in the SQL Editor.** A
column that `pilot.mileage_entries` refuses to let `authenticated` update
(so a pilot can't quietly edit a rate after the fact) will accept a plain
`UPDATE` from the SQL Editor without complaint. That's not a bug to route
around — it's exactly why the caveats in each domain file exist: the
database's own guardrails only apply to the app's three roles, so a human in
the SQL Editor is the one place those guardrails don't reach, and has to
supply the same discipline by hand.

## Schema is `pilot`, not `public`

Nothing in this codebase's `public` schema is ever queried by the app — see
`docs/DEV-GUIDE.md`'s "mental model" section. Every query on this page and
in every domain file assumes you've either:

```sql
set search_path = pilot;
```

...for the rest of the session, or schema-qualified every reference
(`pilot.invoices`, not `invoices`). The templates below schema-qualify
explicitly so they work either way.

## Look before you touch

```sql
-- Full column list, types, defaults, nullability
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'pilot' and table_name = 'invoices'
order by ordinal_position;

-- What authenticated is actually allowed to touch (see the note above —
-- this tells you what the APP can do, not what you can do here)
select privilege_type, string_agg(column_name, ', ' order by column_name) as columns
from information_schema.role_column_grants
where table_schema = 'pilot' and table_name = 'invoices' and grantee = 'authenticated'
group by privilege_type;

-- Foreign keys pointing at or away from a table, before you delete anything
select conname, conrelid::regclass as from_table, confrelid::regclass as to_table
from pg_constraint
where contype = 'f'
  and (conrelid = 'pilot.invoices'::regclass or confrelid = 'pilot.invoices'::regclass);

-- Row-level security policies actually in force on a table
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'pilot' and tablename = 'invoices';
```

## Test before you commit

The SQL Editor runs whatever you press Run on immediately, for real, against
the live database — there is no draft mode. Wrap anything beyond a plain
`SELECT` in a transaction you can inspect and back out of:

```sql
begin;

update pilot.invoices
set notes = 'testing'
where id = '00000000-0000-0000-0000-000000000000';

select id, notes from pilot.invoices where id = '00000000-0000-0000-0000-000000000000';
-- looks right? commit;  -- looks wrong? rollback;

rollback; -- swap for commit once you've actually checked the select above
```

A statement inside `begin`/`rollback` never persists, even if it "succeeds."
This is the single cheapest safety net available and costs nothing to use
by default.

## Generic query templates

**Everything in this schema is tenant-scoped by `account_id`.** A query that
selects across tenants (no `account_id` filter) is doing something the app
itself would never be allowed to do under RLS — usually that's a real signal
you're about to look at, or change, more than you meant to.

```sql
-- Find rows for one account across related tables (adjust table/columns)
select i.id, i.invoice_number, i.status, c.display_name
from pilot.invoices i
left join pilot.clients c on c.id = i.client_id and c.account_id = i.account_id
where i.account_id = '<account-uuid>'
order by i.created_at desc;

-- Count rows per account, to spot one tenant with unusual volume
select account_id, count(*) 
from pilot.invoices
group by account_id
order by count(*) desc
limit 20;

-- A single, targeted, transaction-wrapped update (see "Test before you commit")
begin;
update pilot.<table>
set <column> = <value>
where account_id = '<account-uuid>' and id = '<row-uuid>';
select * from pilot.<table> where id = '<row-uuid>';
rollback; -- or commit;

-- Slow query? See what Postgres actually plans to do
explain analyze
select * from pilot.invoices where account_id = '<account-uuid>' and status = 'overdue';
```

## Changing structure: `ALTER TABLE`

Adding a column is close to always safe. Renaming, retyping, or dropping a
column is not — anything already reading that column name (the app's
TypeScript types in `lib/supabase/database.types.ts`, a view, a function, a
trigger) breaks the moment you run it, silently in places that don't fail
loudly. Grep the codebase for a column's name before renaming or dropping
it — `docs/DEV-GUIDE.md`'s routing/lib map tells you where the code that
might reference it lives.

```sql
-- Add a column (safe: nothing existing can already depend on it)
alter table pilot.<table> add column <new_column> text;

-- Add it with a default and NOT NULL in one step (Postgres 11+: no table
-- rewrite for a constant default)
alter table pilot.<table> add column <new_column> boolean not null default false;

-- Rename a column (breaks anything that names the old column — grep first)
alter table pilot.<table> rename column <old_name> to <new_name>;

-- Change a column's type (can fail or silently truncate/round data —
-- always test the USING expression against real rows in a transaction first)
alter table pilot.<table> alter column <column> type <new_type> using <column>::<new_type>;

-- Add a CHECK constraint (validates existing rows immediately — will fail
-- outright if any current row violates it)
alter table pilot.<table> add constraint <name> check (<condition>);

-- Add a foreign key
alter table pilot.<table>
  add constraint <name> foreign key (<column>) references pilot.<other_table>(<column>);
```

## When to write a migration instead of an ad-hoc edit

This repo's actual convention (`supabase/migrations/`, documented in
`supabase/migrations/README.md` and `docs/DEV-GUIDE.md`) is that every
schema change — every `ALTER TABLE`, every new table, every constraint —
is a timestamped `.sql` file in that folder, applied in order, with a header
explaining the reasoning. A one-off run in the SQL Editor is fine for
**looking at data** (every `SELECT` above) and for **fixing one bad row**
(the transaction-wrapped `UPDATE` template, for genuine data repair). It is
**not** how this repo makes schema changes: an `ALTER TABLE` typed into the
SQL Editor and never turned into a migration file exists only in the live
database, not in git, not in any other environment rebuilt from these
migrations, and not in `lib/supabase/database.types.ts` until someone
regenerates it — three ways for the codebase and the database to quietly
disagree about what the schema actually is.

If you're changing structure (not fixing a row's data), write the migration
file first, apply it the way this repo already does (see
`supabase/migrations/README.md`'s note on `apply_migration`), and treat the
SQL Editor run as *how you tested the migration*, not as the change itself.

## Two mistakes worth naming once

- **`revoke` drops every column grant on a table, not just the one you
  name.** If you ever revoke a privilege by hand, read every existing grant
  on that table first — see `supabase/migrations/README.md`, "the revoke
  trap." This has broken this schema more than once.
- **A `SELECT` policy is required for `UPDATE` to work as expected**, even
  though it looks like it shouldn't be — Postgres evaluates RLS's `USING`
  clause for updates too. Not usually your problem in the SQL Editor (see
  the top of this page), but worth knowing if you're ever writing a new
  policy rather than just querying through existing ones.
