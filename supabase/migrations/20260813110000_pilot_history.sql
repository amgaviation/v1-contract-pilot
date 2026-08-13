-- ===========================================================================
-- The pilot-history report, and the filter it is read through
--
-- Two additions, both driven by the same document: the pilot-history form
-- an insurance underwriter, a chief pilot, or a Part 135 director of
-- operations hands a contract pilot before they will let them near an
-- airframe. 20260810110000 built the registry that made "how much time do
-- you have in the 560?" answerable. This closes two gaps that form still
-- opens, and adds nothing else.
--
-- ***************************************************************************
-- WHAT THIS MIGRATION IS NOT. It does not compute currency, it does not
-- compare an hour count to a limit, and it names no regulation whose
-- ARITHMETIC it performs. Every function below sums columns the pilot
-- entered and stops. The rule the whole feature is built to
-- (app/(app)/reports/pilot-history/report-lib.ts's header carries it
-- verbatim): pure arithmetic over what the pilot logged and recorded; NO
-- currency or legality conclusion anywhere.
--
-- It also does not alter, drop or recreate a single existing column,
-- CHECK, policy, view or grant. Both grants at the foot are ADDITIVE
-- column grants on a table that predates this file — the README's revoke
-- trap says a table-level grant wipes every column grant at once, so
-- nothing here revokes anything first.
-- ***************************************************************************
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Retractable gear.
--
-- WHY IT IS A COLUMN AND NOT A READING OF `gear`. pilot.aircraft.gear
-- already exists and records tricycle / tailwheel / skid / float / ski —
-- but that column answers a DIFFERENT question. It exists because the
-- full-stop condition on general experience turns on whether an airplane
-- is a taildragger, and its five values are about what the aeroplane
-- stands on, not about whether the legs fold. A Bonanza is tricycle AND
-- retractable; a Super Cub is tailwheel and fixed; a Citation is both
-- tricycle and retractable. Deriving retract time from `gear` would be
-- inventing a fact from an unrelated one, and would be wrong for the most
-- common piston airframes a low-time pilot is asked about.
--
-- WHY THE FORM ASKS. Retractable-gear time is a rated line on essentially
-- every pilot-history form and open-pilot warranty, alongside total time,
-- make-and-model time and turbine time, because gear-up landings are their
-- own claims category. A pilot who cannot state the number gets the
-- underwriter's default assumption instead of their own record.
--
-- NULLABLE, AND NULL MEANS NOT RECORDED — never "fixed". This is the exact
-- reasoning already written out for `gear` (20260810110000) and for
-- `is_turbine` / `certificated_more_than_one_pilot`
-- (20260811040000_currency_snapshots.sql): defaulting every pre-existing
-- airframe to false would write an assertion the pilot never made, and the
-- report would then print a retract figure that is confidently short by
-- however many airframes nobody has annotated yet. No backfill statement
-- appears in this file. The report reads the three states apart and says
-- "not recorded" rather than "0.0" — see report-lib.ts's coverage
-- accounting.
-- ---------------------------------------------------------------------------
alter table pilot.aircraft add column if not exists is_retractable boolean;

comment on column pilot.aircraft.is_retractable is
  'Whether this airframe has retractable landing gear. A rated line on an insurance pilot-history form and an open-pilot warranty, and NOT derivable from pilot.aircraft.gear — that column records tricycle/tailwheel/skid/float/ski, which is a different fact (a Bonanza is tricycle and retractable; a Super Cub is tailwheel and fixed). NULL means not recorded and must never be read as fixed-gear: the pilot-history report reports unannotated hours as unrecorded rather than folding them into a zero.';

-- ---------------------------------------------------------------------------
-- 2. One definition of "the filtered logbook", used twice.
--
-- THE PROBLEM. The logbook screen is getting saved filter views (by tail,
-- by type, by role, by date range), and a filtered view has to show its own
-- totals — the whole reason a pilot saves "N447SP, as PIC" as a view is to
-- read the number at the top of it. But every totals view in this schema
-- (pilot.logbook_totals, logbook_time_by_type, aircraft_time_by_tail) is
-- account-global by construction: they group by account_id and take no
-- arguments, so none of them can answer a filtered question.
--
-- The tempting alternative is to fetch the filtered rows and sum them in
-- the app. That is exactly the defect pilot.logbook_totals was created to
-- close (20260810090000): the Data API clamps a response to ~1000 rows and
-- TRUNCATES SILENTLY, so a career pilot filtering to their most-flown tail
-- would read a total computed from whatever fitted. A total that changes
-- with pagination is worse than no total.
--
-- So the filter lives in the database, once, and both readers go through
-- it: `logbook_filtered` IS the predicate, and `logbook_filtered_totals`
-- aggregates over that same function rather than restating its WHERE
-- clause. Two copies of a filter is how the list and the total that
-- captions it come to disagree.
--
-- SECURITY INVOKER, DELIBERATELY (the default, stated anyway — same
-- posture as pilot.trip_committed_invoice). A DEFINER form would bypass
-- pilot.logbook_entries' RLS and turn a tenant-supplied p_account_id into
-- a cross-tenant read of another pilot's legal record. As INVOKER, RLS on
-- logbook_entries and pilot.aircraft is what actually bounds the result and
-- p_account_id is only a filter within it. `set search_path = ''` with
-- every reference schema-qualified, per the house rule.
--
-- NULL ARGUMENT = NOT FILTERED, for every parameter. So the no-filter call
-- returns the whole logbook and its totals agree with pilot.logbook_totals
-- by construction — the two must never disagree on the same screen.
--
-- THE TYPE PREDICATE IS THE VIEW'S OWN. The coalesce below is copied
-- verbatim from pilot.logbook_time_by_type (20260810110000), FAA type
-- rating preferred over ICAO designator over whatever the pilot typed on
-- the entry, falling back to 'Unspecified'. If a pilot filters to the row
-- that panel showed them, they have to get that row's entries — a filter
-- that groups differently from the table it was clicked from is a bug the
-- pilot has no way to see.
-- ---------------------------------------------------------------------------
create or replace function pilot.logbook_filtered(
  p_account_id uuid,
  p_tail_key text default null,
  p_type_label text default null,
  p_role text default null,
  p_from date default null,
  p_to date default null
)
returns setof pilot.logbook_entries
language sql
stable
security invoker
set search_path = ''
as $$
  select e.*
  from pilot.logbook_entries e
  -- LEFT, not inner: an entry whose ident matches no registered airframe
  -- is still the pilot's flying and still belongs in the filtered set and
  -- its totals. Dropping unmatched entries is the one thing an hours
  -- report must never do. unique (account_id, tail_key) on pilot.aircraft
  -- is what makes this join incapable of duplicating a row.
  left join pilot.aircraft a
    on a.account_id = e.account_id
   and a.tail_key = upper(regexp_replace(coalesce(e.aircraft_ident, ''), '[^A-Za-z0-9]', '', 'g'))
  where e.account_id = p_account_id
    and (
      p_tail_key is null
      or upper(regexp_replace(coalesce(e.aircraft_ident, ''), '[^A-Za-z0-9]', '', 'g')) = p_tail_key
    )
    and (p_role is null or e.role = p_role)
    and (p_from is null or e.entry_date >= p_from)
    and (p_to is null or e.entry_date <= p_to)
    and (
      p_type_label is null
      or coalesce(
           nullif(btrim(a.type_rating), ''),
           nullif(btrim(a.type_designator), ''),
           nullif(btrim(e.aircraft_type), ''),
           'Unspecified'
         ) = p_type_label
    );
$$;

comment on function pilot.logbook_filtered(uuid, text, text, text, date, date) is
  'The pilot''s logbook narrowed by a saved view''s filter — tail (on the same normalised key pilot.aircraft.tail_key is generated with), type label (the coalesce pilot.logbook_time_by_type groups on, so a filter clicked from that panel returns that panel''s rows), crew role, and an inclusive date range. A NULL argument means that facet is not filtered, so the all-null call is the whole logbook. SECURITY INVOKER on purpose: a DEFINER form would make p_account_id a cross-tenant read of another pilot''s 61.51 record. The single definition of the filter — pilot.logbook_filtered_totals aggregates over THIS function rather than restating its WHERE clause, so a list and the total captioning it cannot drift.';

-- ---------------------------------------------------------------------------
-- The totals for that same set.
--
-- COLUMN-FOR-COLUMN pilot.logbook_totals (20260810150000), including the
-- order — simulator_time last, because that view had to append it and the
-- two are read side by side. Every arithmetic decision is that view's, not
-- a new one:
--
--   total_time     AIRCRAFT time: total_time minus simulator_time, floored
--                  at zero. A session in a box is not time in an aeroplane
--                  and an underwriter's form asks for the two separately.
--                  greatest(...,0) so one bad row costs its own hours and
--                  never someone else's.
--   instrument_time actual + simulated, summed HERE and only here for
--                  display; the two stay distinct per entry.
--   landings       all four kinds. The full-stop split is preserved per
--                  entry and is not this figure's business.
--   simulator_time reported on its own line, never folded into the total.
--
-- first/last_entry_date are added because a filtered total means nothing
-- without the span it covers: "412.6 hours" reads very differently over
-- eleven months than over eleven years, and the screen states both.
-- ---------------------------------------------------------------------------
create or replace function pilot.logbook_filtered_totals(
  p_account_id uuid,
  p_tail_key text default null,
  p_type_label text default null,
  p_role text default null,
  p_from date default null,
  p_to date default null
)
returns table (
  entry_count bigint,
  total_time numeric,
  pic_time numeric,
  sic_time numeric,
  night_time numeric,
  cross_country_time numeric,
  instrument_time numeric,
  landings bigint,
  simulator_time numeric,
  first_entry_date date,
  last_entry_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint,
    coalesce(sum(greatest(e.total_time - coalesce(e.simulator_time, 0), 0)), 0)::numeric,
    coalesce(sum(e.pic_time), 0)::numeric,
    coalesce(sum(e.sic_time), 0)::numeric,
    coalesce(sum(e.night_time), 0)::numeric,
    coalesce(sum(e.cross_country_time), 0)::numeric,
    coalesce(sum(coalesce(e.instrument_actual_time, 0)
               + coalesce(e.instrument_simulated_time, 0)), 0)::numeric,
    coalesce(sum(
      coalesce(e.day_landings_full_stop, 0)
      + coalesce(e.day_landings_touch_go, 0)
      + coalesce(e.night_landings_full_stop, 0)
      + coalesce(e.night_landings_touch_go, 0)
    ), 0)::bigint,
    coalesce(sum(e.simulator_time), 0)::numeric,
    min(e.entry_date),
    max(e.entry_date)
  from pilot.logbook_filtered(
    p_account_id, p_tail_key, p_type_label, p_role, p_from, p_to
  ) e;
$$;

comment on function pilot.logbook_filtered_totals(uuid, text, text, text, date, date) is
  'Totals over pilot.logbook_filtered''s result set, computed IN THE DATABASE so a filtered view''s headline figure is never a sum of whatever fitted inside the Data API''s ~1000-row response cap. Column-for-column pilot.logbook_totals, same order, same arithmetic: total_time is AIRCRAFT time (total minus simulator, floored at zero), instrument_time is actual+simulated summed for display only, landings counts all four kinds, and simulator_time is reported on its own line and never added to the total. Aggregates over pilot.logbook_filtered rather than restating its WHERE clause, so the list and its caption cannot disagree. Totals only — nothing here compares an hour count to any limit.';

-- ---------------------------------------------------------------------------
-- Grants. Additive only.
--
-- The two column grants below are the shape 20260811040000 used for
-- is_turbine on this same table: pilot.aircraft's INSERT and UPDATE grants
-- are column-scoped (20260810110000), so a column added later is NOT
-- writable until it is named. Its SELECT grant is table-level and already
-- covers the new column.
--
-- revoke-from-public-then-grant on each function, matching
-- pilot.trip_committed_invoice: `public` includes `anon`, and these read a
-- pilot's legal record. RLS would refuse an anonymous caller anyway; the
-- revoke means the function is not even callable, which is one fewer thing
-- resting on a policy being right.
-- ---------------------------------------------------------------------------
grant insert (is_retractable) on pilot.aircraft to authenticated;
grant update (is_retractable) on pilot.aircraft to authenticated;

revoke all on function pilot.logbook_filtered(uuid, text, text, text, date, date) from public;
grant execute on function pilot.logbook_filtered(uuid, text, text, text, date, date)
  to authenticated, service_role;

revoke all on function pilot.logbook_filtered_totals(uuid, text, text, text, date, date) from public;
grant execute on function pilot.logbook_filtered_totals(uuid, text, text, text, date, date)
  to authenticated, service_role;
