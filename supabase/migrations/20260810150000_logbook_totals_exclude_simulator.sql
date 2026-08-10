-- ===========================================================================
-- Career "Total time" stops including simulator hours
--
-- THE CONTRADICTION, on one screen. /logbook renders career totals from
-- pilot.logbook_totals and, directly beneath them, hours by type from
-- pilot.logbook_time_by_type. 20260810110000 made the by-type view report
-- AIRCRAFT time — total_time minus simulator_time — with simulator hours
-- in their own column, because a full-flight-simulator session is stored
-- with its hours in total_time (20260810020000's CHECK requires exactly
-- that) and an insurance pilot-history form asks for the two separately.
--
-- logbook_totals was left summing raw total_time. So a pilot with 40 hours
-- of recurrent in a box saw a career total 40 hours higher than the sum of
-- the type rows immediately below it, with nothing explaining the gap. One
-- of those two numbers was wrong, and it was this one: "total time" on a
-- pilot-history form, an employment application, or an insurance
-- submission means time in an aircraft.
--
-- WHAT CHANGES. total_time becomes aircraft time, and simulator_time
-- becomes its own column rather than being folded away — nothing is
-- dropped, the two facts are just no longer added together. Every other
-- column is unchanged, verbatim, including the instrument_time sum whose
-- own comment explains why actual and simulated are added there.
--
-- WHAT DOES NOT CHANGE: pilot.logbook_entries. Simulator time is real
-- logged time under 61.51(b) and stays exactly where the pilot recorded
-- it. This is a reporting view; it decides how the number is PRESENTED,
-- never what was logged.
-- ===========================================================================

create or replace view pilot.logbook_totals
with (security_invoker = true) as
  select
    e.account_id,
    count(*)::bigint                                  as entry_count,
    -- AIRCRAFT time. greatest(..., 0) because an entry whose simulator
    -- time somehow exceeds its total must not subtract from the career
    -- figure — a bad row should cost its own hours, never someone else's.
    coalesce(sum(greatest(e.total_time - coalesce(e.simulator_time, 0), 0)), 0)::numeric
                                                      as total_time,
    coalesce(sum(e.pic_time), 0)::numeric             as pic_time,
    coalesce(sum(e.sic_time), 0)::numeric             as sic_time,
    coalesce(sum(e.night_time), 0)::numeric           as night_time,
    coalesce(sum(e.cross_country_time), 0)::numeric   as cross_country_time,
    -- Actual and simulated are logged separately (61.51(b)(3)(ii),(iii))
    -- and summed only for display. The two columns stay distinct in the
    -- table; this is the one place they are added together.
    coalesce(sum(coalesce(e.instrument_actual_time, 0)
               + coalesce(e.instrument_simulated_time, 0)), 0)::numeric
                                                      as instrument_time,
    -- Every landing, however it ended. The full-stop split matters for
    -- currency and is preserved per-entry; this is the headline count.
    coalesce(sum(
      coalesce(e.day_landings_full_stop, 0)
      + coalesce(e.day_landings_touch_go, 0)
      + coalesce(e.night_landings_full_stop, 0)
      + coalesce(e.night_landings_touch_go, 0)
    ), 0)::bigint                                     as landings,
    -- APPENDED, and it has to be. `create or replace view` may only add
    -- columns at the END — inserting simulator_time next to total_time
    -- where it reads best raised "cannot change name of view column
    -- pic_time to simulator_time", because Postgres matches the new column
    -- list to the old one positionally. Column order in a view is an
    -- interface, not a formatting choice.
    --
    -- Reported, not discarded. A pilot who flew 40 hours of recurrent did
    -- the work and an underwriter asks for it — on its own line, never
    -- added into total_time.
    coalesce(sum(e.simulator_time), 0)::numeric       as simulator_time
  from pilot.logbook_entries e
  group by e.account_id;

comment on view pilot.logbook_totals is
  'Career totals over every entry the pilot owns — never over a page, because a career total that changes with pagination is worse than none. total_time is AIRCRAFT time: simulator hours are reported in their own column and never added to it, matching pilot.logbook_time_by_type on the same screen and matching what an insurance pilot-history form asks for.';

grant select on pilot.logbook_totals to authenticated, service_role;
