-- ===========================================================================
-- Aircraft, as a thing rather than a string
--
-- THE PROBLEM. `aircraft_ident` and `aircraft_type` are free text on both
-- pilot.trips and pilot.logbook_entries, retyped on every trip and every
-- entry, with no autocomplete and no normalisation. So N447SP, N-447SP and
-- n447sp are three aircraft as far as any rollup is concerned, and there is
-- no rollup anyway: the logbook totals Total / PIC / Night / Instrument /
-- Landings and stops.
--
-- WHY THAT MATTERS MORE THAN IT LOOKS. Time in make and model is what an
-- insurance underwriter's pilot-history form asks for, what an open-pilot
-- warranty is written against, and what a chief pilot asks on the phone
-- before offering a trip. The aviation reference describes a pilot's
-- profile as "partly an insurance-approval dossier: hours by category/
-- class/type". This product could not answer "how much time do you have in
-- the 560?" at all.
--
-- WHAT THIS DOES NOT DO, deliberately: it does not rewrite a single
-- logbook row. pilot.logbook_entries is a legal record under 61.51 and its
-- stored aircraft_ident is what the pilot wrote. Normalisation happens at
-- READ time, in the view at the bottom, by matching on a canonical key.
-- A registry row is an annotation on history, never an edit to it.
--
-- The gear column is not decoration. 61.57(a)(1) requires the three
-- takeoffs and landings to be made TO A FULL STOP "if the aircraft to be
-- flown is an airplane with a tailwheel" — verified against the current
-- CFR text (govinfo, 14 CFR part 61, retrieved 2026-08-10). Day currency
-- therefore depends on a fact about the airframe that nothing in this
-- schema recorded. Phase 7's engine will need it; capturing it now costs
-- one column and avoids asking a pilot to re-annotate their fleet later.
-- ===========================================================================

create table if not exists pilot.aircraft (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,

  -- As the pilot writes it, and rendered back to them that way.
  tail_number text not null check (length(btrim(tail_number)) between 2 and 12),

  -- What everything JOINS on. Case-folded, punctuation-stripped, so
  -- "N447SP", "N-447SP" and "n447sp" are one aircraft — the fragmentation
  -- the free-text columns already guarantee. GENERATED, so it cannot drift
  -- from tail_number and no writer can forget to maintain it.
  tail_key text generated always as (
    upper(regexp_replace(tail_number, '[^A-Za-z0-9]', '', 'g'))
  ) stored,
  -- A tail number of nothing but punctuation and non-Latin letters passes
  -- the length CHECK above and normalises to ''. One such row would take
  -- the account's single `unique (account_id, '')` slot, match no logbook
  -- entry ever, and make the NEXT one fail with a duplicate error naming
  -- an aircraft the pilot cannot find. Refused here rather than left to
  -- the app: the app's own guard has to reimplement this normalisation in
  -- JavaScript, and the two implementations have already disagreed once.
  constraint aircraft_tail_key_not_empty check (tail_key <> ''),

  -- ICAO type designator (C560, BE40, PC12). Optional: a pilot may add an
  -- aircraft before they know it, and a wrong designator is worse than a
  -- blank one on a form an underwriter reads.
  type_designator text check (type_designator is null or type_designator ~ '^[A-Z0-9]{2,4}$'),
  make_model text,

  -- 61.57(a)(1)'s tailwheel full-stop condition. Null means "not recorded"
  -- and must never be read as "tricycle" — a currency engine that assumes
  -- the common case would tell a tailwheel pilot they are current on
  -- touch-and-goes that do not count.
  gear text check (gear is null or gear in ('tricycle', 'tailwheel')),

  -- Free text on purpose. The category/class vocabulary (ASEL, AMEL, ASES,
  -- rotorcraft-helicopter, glider...) is long, and a CHECK that is wrong
  -- for a pilot's aircraft is worse than a field they fill in themselves.
  category_class text,

  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (account_id, id),
  -- One row per airframe per account. This is the constraint that makes
  -- the whole registry worth having.
  unique (account_id, tail_key)
);

comment on table pilot.aircraft is
  'The pilot''s own fleet: one row per airframe, keyed on a normalised tail number so N447SP / N-447SP / n447sp cannot become three aircraft. Annotates history — it never rewrites pilot.logbook_entries, which is a legal record under 61.51.';
comment on column pilot.aircraft.gear is
  '61.57(a)(1) requires day takeoffs and landings to be made to a FULL STOP for a tailwheel airplane. NULL means not recorded and must not be read as tricycle.';

create index if not exists aircraft_account_idx on pilot.aircraft (account_id, tail_key);

drop trigger if exists aircraft_set_updated_at on pilot.aircraft;
create trigger aircraft_set_updated_at before update on pilot.aircraft
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- Hours by type.
--
-- The join is on the SAME normalisation the registry stores, applied to
-- the logbook's free-text ident at read time. An entry whose tail is not
-- in the registry still appears — grouped under whatever aircraft_type the
-- pilot typed on the entry itself, or "Unspecified". Dropping unmatched
-- entries would understate a pilot's hours, which is the one thing a
-- time-in-type table must never do.
-- ---------------------------------------------------------------------------
create or replace view pilot.logbook_time_by_type
with (security_invoker = true) as
  select
    e.account_id,
    coalesce(
      nullif(btrim(a.type_designator), ''),
      nullif(btrim(e.aircraft_type), ''),
      'Unspecified'
    )                                                   as type_label,
    count(*)::bigint                                    as entry_count,
    coalesce(sum(e.total_time), 0)::numeric             as total_time,
    coalesce(sum(e.pic_time), 0)::numeric               as pic_time,
    coalesce(sum(e.night_time), 0)::numeric             as night_time,
    -- Whether any of this type's time is in a registered airframe, so the
    -- UI can tell "you have 412 hours in the 560" from "you have 412 hours
    -- in something you never told us about".
    bool_or(a.id is not null)                           as has_registered_aircraft
  from pilot.logbook_entries e
  left join pilot.aircraft a
    on a.account_id = e.account_id
   and a.tail_key = upper(regexp_replace(coalesce(e.aircraft_ident, ''), '[^A-Za-z0-9]', '', 'g'))
  group by
    e.account_id,
    coalesce(
      nullif(btrim(a.type_designator), ''),
      nullif(btrim(e.aircraft_type), ''),
      'Unspecified'
    );

comment on view pilot.logbook_time_by_type is
  'Hours by aircraft type — what an insurance pilot-history form asks for. Matches the logbook''s free-text ident to the registry on a normalised key at READ time; unmatched entries are still counted, under the type the pilot typed, because a time-in-type table that silently drops hours is worse than none.';

-- ---------------------------------------------------------------------------
-- Hours in each registered airframe.
--
-- "How much time do you have in the 560?" is the type question, answered
-- above. "How much time in N447SP?" is the OTHER one an open-pilot
-- warranty is written against, and it is a different number when a pilot
-- flies two of the same type for two different owners.
--
-- A LEFT JOIN, not an inner one: an aircraft registered today has no
-- hours yet and must still appear in the pilot's fleet. Reporting it as
-- absent rather than as zero would make the fleet list disagree with
-- itself the moment a pilot adds an airframe before flying it.
-- ---------------------------------------------------------------------------
create or replace view pilot.aircraft_time_by_tail
with (security_invoker = true) as
  select
    a.account_id,
    a.id                                                as aircraft_id,
    count(e.id)::bigint                                 as entry_count,
    coalesce(sum(e.total_time), 0)::numeric             as total_time,
    coalesce(sum(e.pic_time), 0)::numeric               as pic_time,
    coalesce(sum(e.night_time), 0)::numeric             as night_time,
    max(e.entry_date)                                   as last_flown_on
  from pilot.aircraft a
  left join pilot.logbook_entries e
    on e.account_id = a.account_id
   and upper(regexp_replace(coalesce(e.aircraft_ident, ''), '[^A-Za-z0-9]', '', 'g')) = a.tail_key
  group by a.account_id, a.id;

comment on view pilot.aircraft_time_by_tail is
  'Hours logged against each registered airframe, matched on the normalised tail key at READ time. LEFT JOIN so an aircraft added before it is flown reports zero hours rather than vanishing from the pilot''s own fleet list.';

-- ---------------------------------------------------------------------------
-- What the pilot has flown but never told us about.
--
-- A registry a pilot has to populate by retyping tails the logbook already
-- holds is a registry that stays empty. This is the fleet screen's own
-- seed list: every distinct tail in the logbook with no registry row,
-- newest first, with enough hours attached that the pilot can tell the
-- airframe they fly weekly from the one they rode in once.
--
-- Idents that normalise to nothing (a blank, a lone hyphen, a stray
-- punctuation mark from a CSV import) are excluded — offering to register
-- '' helps nobody and the unique key would collapse them all into one row.
-- ---------------------------------------------------------------------------
create or replace view pilot.aircraft_unregistered_idents
with (security_invoker = true) as
  select
    e.account_id,
    -- Shown back as the pilot most recently wrote it, not as the key.
    (array_agg(e.aircraft_ident order by e.entry_date desc, e.created_at desc))[1]
                                                        as aircraft_ident,
    upper(regexp_replace(e.aircraft_ident, '[^A-Za-z0-9]', '', 'g'))
                                                        as tail_key,
    max(nullif(btrim(e.aircraft_type), ''))             as aircraft_type,
    count(*)::bigint                                    as entry_count,
    coalesce(sum(e.total_time), 0)::numeric             as total_time,
    max(e.entry_date)                                   as last_flown_on
  from pilot.logbook_entries e
  where e.aircraft_ident is not null
    and upper(regexp_replace(e.aircraft_ident, '[^A-Za-z0-9]', '', 'g')) <> ''
    and not exists (
      select 1
      from pilot.aircraft a
      where a.account_id = e.account_id
        and a.tail_key = upper(regexp_replace(e.aircraft_ident, '[^A-Za-z0-9]', '', 'g'))
    )
  group by
    e.account_id,
    upper(regexp_replace(e.aircraft_ident, '[^A-Za-z0-9]', '', 'g'));

comment on view pilot.aircraft_unregistered_idents is
  'Tails the pilot has logged time in that have no pilot.aircraft row yet — the fleet screen''s seed list, so building a registry is confirming what you already flew rather than retyping it. NOT EXISTS, never NOT IN: a null on either side of NOT IN fails open and would hide every suggestion.';

-- ---------------------------------------------------------------------------
-- RLS and grants.
-- ---------------------------------------------------------------------------
alter table pilot.aircraft enable row level security;

create policy aircraft_select on pilot.aircraft for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy aircraft_insert on pilot.aircraft for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy aircraft_update on pilot.aircraft for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
-- No DELETE policy: an airframe a pilot flew is part of how their history
-- reads. archived_at hides it from pickers without breaking the join that
-- gives three years of entries their type.
create policy aircraft_delete on pilot.aircraft for delete to authenticated
  using (false);

grant select on pilot.aircraft to authenticated;
-- Column-scoped, like every other table here: tail_key is GENERATED and
-- cannot be written, and account_id is set on insert but never changed.
grant insert (account_id, tail_number, type_designator, make_model, gear,
              category_class, notes)
  on pilot.aircraft to authenticated;
grant update (tail_number, type_designator, make_model, gear, category_class,
              notes, archived_at)
  on pilot.aircraft to authenticated;

grant select on pilot.logbook_time_by_type to authenticated, service_role;
grant select on pilot.aircraft_unregistered_idents to authenticated, service_role;
grant select on pilot.aircraft_time_by_tail to authenticated, service_role;
grant select, insert, update, delete on pilot.aircraft to service_role;
