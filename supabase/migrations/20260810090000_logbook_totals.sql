-- ===========================================================================
-- Logbook totals that are not a function of what fitted on the page
--
-- /logbook selected the most recent 1000 entries and summed THOSE, with a
-- caveat saying the totals "may be partial". Two problems with that, and
-- the caveat only admits one of them:
--
--   1. TOTAL TIME IS THE NUMBER. It is what an employer asks for, what an
--      insurance application asks for, and what a pilot quotes about
--      themselves. A career pilot importing 8,000 entries saw a figure
--      computed from 12% of their own logbook.
--   2. Entries 1001 and beyond were UNREACHABLE — no paging, no date
--      filter, no search. Not merely un-totalled: not viewable at all, in
--      the product's copy of a record 61.51 makes them responsible for
--      keeping.
--
-- Paging fixes (2). It cannot fix (1), because a total computed from a
-- page is a total of that page. So the aggregate moves to the database,
-- where it is computed over every row the pilot owns and does not care
-- what the screen is showing.
--
-- SECURITY INVOKER, so RLS on logbook_entries applies to the aggregate
-- exactly as it does to the rows — same as pilot.invoice_totals and every
-- other view in this schema. A view that summed across tenants would be a
-- far worse bug than the one it fixes.
-- ===========================================================================

create or replace view pilot.logbook_totals
with (security_invoker = true) as
  select
    e.account_id,
    count(*)::bigint                                  as entry_count,
    coalesce(sum(e.total_time), 0)::numeric           as total_time,
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
    coalesce(sum(coalesce(e.day_landings_full_stop, 0)
               + coalesce(e.day_landings_touch_go, 0)
               + coalesce(e.night_landings_full_stop, 0)
               + coalesce(e.night_landings_touch_go, 0)), 0)::bigint
                                                      as landings
  from pilot.logbook_entries e
  group by e.account_id;

comment on view pilot.logbook_totals is
  'Career totals over EVERY entry the pilot owns, not over whatever page is on screen. SECURITY INVOKER so RLS applies. Total time is what an employer and an underwriter ask for — it must never be a function of pagination.';

grant select on pilot.logbook_totals to authenticated, service_role;
