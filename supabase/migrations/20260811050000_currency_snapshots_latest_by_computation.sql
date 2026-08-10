-- pilot.currency_snapshots_latest returned the FURTHEST-FORWARD evaluation
-- date instead of the MOST RECENT COMPUTATION. This corrects the ordering and
-- the index that serves it.
--
-- WHY THIS IS A SEPARATE FILE rather than an edit to
-- 20260811040000_currency_snapshots.sql. Two reasons, and the second is the
-- one that matters:
--
--   1. supabase/migrations/README.md records that this project's migrations
--      are applied through a tool that stamps its own version from the server
--      clock, so the recorded versions do not equal these filenames and
--      whether any given file has been applied is NOT determinable from the
--      repository. Editing 040000 in place would be correct only in the world
--      where it has not been applied, and nothing here can establish that.
--
--   2. Even in that world the edit would be unsafe, because 040000 creates the
--      index with `create index if not exists`. That form matches on NAME, not
--      on definition. Re-running an edited 040000 against a database that
--      already holds the index silently SKIPS it — no error, no notice — and
--      leaves a live index whose column order disagrees with the view the file
--      claims to define. A migration that no longer describes the database,
--      produced with no error, is exactly the failure mode this project's
--      migrations README exists to warn about.
--
-- So: a new file, and the index is dropped by name and recreated rather than
-- guarded with `if not exists`. Both statements below are idempotent and both
-- are correct whether or not 040000 has been applied.
--
-- ADDITIVE ONLY. No grant, policy, constraint or column is touched. The
-- view's SELECT LIST IS UNCHANGED — same columns, same order, same types — so
-- `create or replace view` is legal here despite that file's own warning that
-- replacement matches columns positionally and may only append. Only the
-- ORDER BY inside the view changes.

-- =============================================================================
-- THE DEFECT
-- =============================================================================
--
-- 040000's view read:
--
--   select distinct on (account_id, airman_user_id, currency_type) ...
--   order by account_id, airman_user_id, currency_type,
--            as_of desc, computed_at desc, id desc;
--
-- DISTINCT ON keeps the FIRST row per group under that ORDER BY, so `as_of
-- desc` decides which snapshot a reader gets and `computed_at` only breaks
-- ties between rows sharing an evaluation date. Once any row exists whose
-- as_of is ahead of another's, every later recomputation carrying the smaller
-- as_of sorts behind it and is never returned.
--
-- WHY THAT IS WRONG AND NOT MERELY UNTIDY. The shadowed row is not a
-- redundant recomputation of the same facts — it is computed from CHANGED
-- facts. Logbook entries are editable (app/(app)/logbook/actions.ts), and the
-- corrections that matter most all REMOVE credit:
--
--   * a landing count corrected downward;
--   * an aircraft's gear recorded, after which a tricycle-gear landing stops
--     counting toward a tailwheel pilot's 61.57(a)(1)(ii) currency;
--   * a role corrected to DUAL_RECEIVED, which docs/CURRENCY-SPEC.md requires
--     never count toward 61.57(a) or (b);
--   * a read that came back truncated, which lib/currency turns into
--     insufficient_data.
--
-- In each case the newer computation is STRICTER, the older one says
-- estimated_current, and the view hands back the older one. That is
-- permissive staleness on a currency card — a screen telling a pilot they are
-- current on arithmetic the engine has since revised downward. It is the one
-- direction this engine is built never to fail in.
--
-- IT DOES NOT NEED A FUTURE-DATED WRITE TO HAPPEN. It needs only two
-- evaluations whose as_of order disagrees with their computed_at order, and
-- lib/currency/read.ts already documents that condition as expected: an as_of
-- taken in the pilot's local timezone runs behind a server-side UTC date for
-- any client west of Greenwich after 17:00 local. Two recomputes either side
-- of local midnight are enough.
--
-- WHAT "LATEST" MEANS HERE, stated once so the next edit does not have to
-- infer it: the most recently COMPUTED assessment of the pilot's current
-- state. That is what 040000's own comments already claimed — its index
-- comment frames the view in terms of recomputation ("recomputing the same
-- day writes a new row rather than rewriting yesterday's answer... The index
-- is what makes 'the latest one' cheap") and its view comment explains
-- computed_at and the id tiebreak without mentioning as_of at all. The
-- ORDER BY was the only part of that file implementing a different meaning.

-- =============================================================================
-- THE INDEX
-- =============================================================================
--
-- Dropped by name and recreated. `create index if not exists` is deliberately
-- NOT used: it is precisely the statement that would no-op against the
-- existing index and leave the live column order disagreeing with the view.
--
-- The column order mirrors the view's ORDER BY exactly, so the whole
-- DISTINCT ON is satisfiable from one index scan. id is carried into the
-- index for the same reason it is in the ORDER BY: computed_at defaults to
-- the transaction timestamp, so the five snapshots written by a single
-- recompute share it to the microsecond, and without a deterministic final
-- key the panel would flip between renders.
drop index if exists pilot.currency_snapshots_latest_idx;

create index currency_snapshots_latest_idx
  on pilot.currency_snapshots
     (account_id, airman_user_id, currency_type, computed_at desc, as_of desc, id desc);

-- =============================================================================
-- THE VIEW
-- =============================================================================
--
-- security_invoker preserved from 040000 — without it the base table's RLS
-- would stop applying and every airman would read every other airman's
-- medical expiry through this view.
create or replace view pilot.currency_snapshots_latest
with (security_invoker = true) as
  select distinct on (account_id, airman_user_id, currency_type)
    id, account_id, airman_user_id, currency_type, status, rule_basis, as_of,
    window_start, window_end, through_date, limiting_item, limiting_date,
    counts, counted_entry_ids, missing_inputs, limitations, computed_at, created_at
  from pilot.currency_snapshots
  order by account_id, airman_user_id, currency_type,
           computed_at desc, as_of desc, id desc;

comment on view pilot.currency_snapshots_latest is
  'The most recently COMPUTED snapshot per airman per currency type — latest computation, not furthest-forward evaluation date. computed_at leads the ordering because a later computation is the one made from corrected logbook facts; ordering by as_of first let an earlier, more permissive verdict shadow a later, stricter one (see this migration''s header). as_of is the second key so two computations sharing a timestamp resolve by evaluation date, and id is the final tiebreak because computed_at defaults to the transaction timestamp and a single recompute writes five rows sharing it exactly. security_invoker so the base table''s RLS still applies. IF PLANNED-TRIP OR WHAT-IF EVALUATIONS ARE EVER BUILT they must not share this table without a discriminator column: no single ordering over a mixed table can serve both "what is my currency now" and "what would it be on the 20th", and this view answers only the first.';
