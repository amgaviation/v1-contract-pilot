# Logbook, Currency & Fleet

Six tables: `logbook_import_batches` (one row per CSV/ForeFlight import run), `logbook_source_files` (the uploaded file behind an import batch), `logbook_entries` (the pilot's personal logbook of record), `operator_qualifications` (what a Part 135 operator told the pilot about their standing), `aircraft` (the pilot's own fleet, keyed on a normalized tail number), `currency_snapshots` (append-only computed currency verdicts).

## logbook_import_batches

One row per CSV or ForeFlight-sync import run — a job record for a bulk logbook import. As of this writing it is schema-only: nothing in the app writes into this table yet, because the CSV/ForeFlight import feature itself hasn't shipped. The table exists now so `logbook_entries.import_batch_id` has something to reference once it does.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`. Identifies the batch.

#### `account_id`
`uuid`, not null. The tenant this import belongs to. Foreign key to `pilot.accounts(id)`.

#### `source_format`
`text`, not null. One of `foreflight`, `logten`, `generic_csv` — which import format produced this batch.

#### `status`
`text`, not null, defaults to `'pending'`. One of `pending`, `processing`, `completed`, `partial`, `failed` — the job's lifecycle state.

#### `total_rows`
`integer`, not null, defaults to `0`, must be `>= 0`. How many rows the source file(s) contained.

#### `imported_rows`
`integer`, not null, defaults to `0`, must be `>= 0`. How many rows were successfully turned into `logbook_entries` rows.

#### `rejected_rows`
`integer`, not null, defaults to `0`, must be `>= 0`. How many rows failed to import (bad data, couldn't be represented in the current schema, etc.).

#### `error_summary`
`text`, nullable. Free-text summary of what went wrong, for a batch that ended `partial` or `failed`.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`. Standard bookkeeping timestamps.

### Notable constraints

RLS is enabled. `source_format` and `status` are each constrained to a fixed vocabulary by CHECK. The three row-count columns each have a non-negative CHECK. There's a composite foreign key from `logbook_source_files(account_id, import_batch_id)` into this table's `(account_id, id)`, and the same composite-FK pattern from `logbook_entries(account_id, import_batch_id)` — both of the standard shape this schema uses everywhere to stop one tenant's row from pointing at another tenant's parent row.

### Changing this table

Straightforward to edit by hand — it's schema-only right now, so there's no live import logic to worry about corrupting. `authenticated` can insert, select, and update every meaningful column except `id`, `created_at`, and `updated_at`. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) before running anything beyond a `SELECT`.

```sql
begin;
update pilot.logbook_import_batches
set status = 'failed', error_summary = 'testing'
where account_id = '<account-uuid>' and id = '<batch-uuid>';
select * from pilot.logbook_import_batches where id = '<batch-uuid>';
rollback; -- or commit;
```

## logbook_source_files

The uploaded file (or files) behind one import batch — the raw CSV/export the pilot uploaded, tracked separately from the batch job so one batch can reference multiple source files. Like `logbook_import_batches`, this is schema-only: nothing writes into it yet.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`.

#### `account_id`
`uuid`, not null. Tenant owner. Foreign key to `pilot.accounts(id)`.

#### `import_batch_id`
`uuid`, not null. Which import batch this file belongs to. Part of a composite foreign key `(account_id, import_batch_id)` into `logbook_import_batches(account_id, id)`, so a file can't be attached to another tenant's batch.

#### `file_name`
`text`, not null. The original filename as uploaded.

#### `file_path`
`text`, nullable. Storage location of the file (once storage wiring exists for this feature).

#### `row_count`
`integer`, nullable, must be `>= 0` when present. Number of data rows the file contained.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled. Composite foreign keys tie this table to both `pilot.accounts` and `pilot.logbook_import_batches` on `account_id` plus the relevant id, and `logbook_entries(account_id, source_file_id)` references back to this table the same way — every link in the import lineage is tenant-scoped, not just id-scoped.

### Changing this table

Same posture as `logbook_import_batches`: schema-only today, safe to edit by hand. `authenticated` can insert/select/update `file_name`, `file_path`, `import_batch_id`, and `row_count`. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

```sql
begin;
update pilot.logbook_source_files
set row_count = 42
where account_id = '<account-uuid>' and id = '<file-uuid>';
rollback; -- or commit;
```

## logbook_entries

This is the pilot's personal logbook of record — a legal record under 14 CFR 61.51, the FAA regulation governing what a pilot must log and how. Every row is one logbook entry: one flight, or one simulator session. Entries arrive here three ways: typed in manually, imported from a CSV/ForeFlight sync, or confirmed from a completed trip leg. That third path matters enough to call out explicitly: a trip's flight legs are never automatically copied into the logbook. The app computes an on-the-fly "draft" from completed trip legs that don't yet have a matching logbook entry, and only a pilot's explicit confirm action (in the app's logbook-drafts screen) turns that draft into a real, stored row here. There is no database trigger that does this — it was a deliberate design choice, because a legal record that could be defensible in an FAA enforcement action or an insurance dispute shouldn't ever be written without the pilot's own action.

Because this table backs a legal record, several of its columns exist specifically to close gaps against particular FAA regulations (61.51 for what must be logged, 61.57 for currency-relevant counts). The column-level comments below carry a lot of that regulatory detail — it's dense but load-bearing; a currency computation or an insurance pilot-history report can be silently wrong if a column's actual regulatory meaning gets misread.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`.

#### `account_id`
`uuid`, not null. Tenant owner. Foreign key to `pilot.accounts(id)`.

#### `source`
`text`, not null. One of `trip`, `import`, `manual`, `foreflight_sync` — how this entry came to exist. `trip` rows only ever arrive via the explicit human confirm action described above.

#### `trip_id`
`uuid`, nullable. If this entry came from a confirmed trip leg, which trip. Composite foreign key `(account_id, trip_id)` into `pilot.trips`.

#### `trip_leg_id`
`uuid`, nullable. Which specific trip leg, if any. Composite foreign key `(account_id, trip_leg_id)` into `pilot.trip_legs`. A unique index on this column (mentioned in the table's originating migration) is what keeps two simultaneous "confirm" clicks on the same leg from creating two logbook entries.

#### `import_batch_id`
`uuid`, nullable. Which CSV/sync import batch produced this row, if any. Composite foreign key into `logbook_import_batches`.

#### `source_file_id`
`uuid`, nullable. Which uploaded source file produced this row, if any. Composite foreign key into `logbook_source_files`.

#### `source_row_number`
`integer`, nullable, must be `>= 1` when present. The row number within the source file this entry came from — useful for tracing an imported entry back to its original CSV row.

#### `row_fingerprint`
`text`, nullable. A dedup fingerprint computed from the source row, used to avoid importing the same logbook line twice.

#### `source_row`
`jsonb`, nullable. The raw imported row data, preserved as-is so an import can be audited or re-processed without needing the original file.

#### `foreflight_sync_id`
`text`, nullable. External identifier from a ForeFlight sync, for matching sync updates to existing rows.

#### `entry_date`
`date`, not null. The calendar date of the flight or sim session.

#### `aircraft_ident`
`text`, nullable. Free-text tail number as the pilot typed it for this entry (not normalized — see `aircraft.tail_key` below for how the fleet registry reconciles variants like `N447SP` / `N-447SP` at read time, without rewriting this column).

#### `aircraft_type`
`text`, nullable. Free-text aircraft type as typed for this entry.

#### `from_icao` / `to_icao`
`text`, nullable, each must match `^[A-Z0-9]{3,4}$` when present. Departure and arrival airport identifiers.

#### `role`
`text`, nullable, default `'PIC'`. One of `PIC`, `SIC`, `SOLO`, `DUAL_RECEIVED` when set. This is the crew-role label for the entry, added to under 14 CFR 61.51: `SOLO` covers 61.51(d) solo flight time, `DUAL_RECEIVED` covers 61.51(h) training received. A deliberately excluded fifth value, `DUAL_GIVEN` (an instructor logging instruction given), was left out because that fact already has its own time column (`flight_instructor_time`) and no real import data needed a separate role value for it. `role` may be `NULL` only for an entry whose time is entirely simulator time — an FFS/FTD/ATD session has no crew role in the FAA sense, since there's no aircraft and no PIC question to answer. A CHECK constraint (see below) enforces that this exemption can't reach an actual flight.

#### `total_time`
`numeric`, not null, must be `>= 0`. Total loggable time for the entry.

#### `pic_time` / `sic_time` / `solo_time` / `cross_country_time` / `night_time` / `instrument_actual_time` / `instrument_simulated_time` / `flight_instructor_time` / `dual_received_time` / `simulator_time`
`numeric`, each nullable, each must be `>= 0` when present. Standard logbook time-category columns. `night_time` specifically means 14 CFR 1.1's civil-twilight definition of night — the time between the end of evening civil twilight and the start of morning civil twilight. This is a materially wider window than the narrower "1 hour after sunset to 1 hour before sunrise" window that 61.57(b) currency actually keys on: a landing in the roughly 25–35 minute gap between sunset and the end of civil twilight is loggable as `night_time` but does not yet count toward `night_takeoffs`/`night_landings_full_stop` below. Conflating the two is described in the currency spec as the single most dangerous silent error this schema makes possible.

#### `simulator_device_type`
`text`, nullable. One of `ffs`, `ftd`, `atd`, `other` when set — the class of simulator device backing `simulator_time`. The three real device classes carry materially different regulatory credit: `ffs` (full flight simulator) is the only device class 61.57(b) night currency will ever accept, and only when its visual system is adjusted for the night period; `ftd` (flight training device) counts toward 61.57(a) day currency but never toward (b) night currency; `atd` (aviation training device) counts only toward 61.57(c) instrument currency, never (a) or (b).

#### `day_landings_full_stop` / `day_landings_touch_go`
`integer`, not null, default `0`, must be `>= 0`. Day landing counts, split by landing type because 61.57(a)(1)(ii) requires the three required landings to be full-stop specifically when the aircraft flown is a tailwheel airplane — for a non-tailwheel aircraft, a touch-and-go counts toward the same general three-landing requirement.

#### `night_takeoffs`
`integer`, not null, default `0`, must be `>= 0`. Takeoffs made specifically within 61.57(b)(1)'s narrower window (1 hour after sunset to 1 hour before sunrise) — not the same window `night_time` uses. A takeoff between sunset and one hour after sunset is `night_time`-eligible but doesn't count here.

#### `night_landings_full_stop`
`integer`, not null, default `0`, must be `>= 0`. Full-stop landings within the same narrow 61.57(b)(1) window. Full stop is required for every aircraft here, not just tailwheel ones — unlike the day-landing case above.

#### `night_landings_touch_go`
`integer`, not null, default `0`, must be `>= 0`. Same window as the full-stop column, but a touch-and-go landing never counts toward 61.57(b) currency (that paragraph requires a full stop). Kept for a complete flight record, not as a currency input.

#### `approaches_count`
`integer`, not null, default `0`, must be `>= 0`. Number of instrument approaches on this entry. 61.57(c)(1) requires six approaches "in actual weather conditions, or under simulated conditions using a view-limiting device" within the preceding six calendar months. This column alone doesn't distinguish a qualifying approach from a visual one — that distinction lives in `approach_type` and `approach_condition` below.

#### `approach_type`
`text`, nullable. One of `ils`, `rnav_lpv`, `rnav_lnav`, `vor`, `loc`, `ndb`, `visual`, `other` when set. A row tagged `visual` is kept as a selectable, legitimate thing to record, but does not satisfy 61.57(c)(1) — a visual approach is flown in neither actual weather nor under a view-limiting device.

#### `holds`
`integer`, not null, default `0`, must be `>= 0`. Number of holding procedures/tasks performed — counts toward 61.57(c)(1)(ii), which is silent on how many repetitions are required (the engine treats "at least once in the window" as sufficient).

#### `remarks`
`text`, nullable. Free-text notes.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`.

#### `airman_user_id`
`uuid`, nullable. Which `account_members.user_id` actually flew this entry — 61.51 is a per-airman duty, and a multi-pilot account needs to know whose logbook each row belongs to. Set server-side from the session on insert, never client-supplied, and never updatable afterward (there's no `UPDATE` grant on this column — see grants below). `NULL` only appears on pre-existing rows from before this column existed on a multi-member account where no source records which member flew it.

#### `day_takeoffs`
`integer`, not null, default `0`, must be `>= 0`. The takeoff half of 61.57(a)(1)'s "three takeoffs and three landings" pair — previously missing from the schema entirely. 61.57(a) applies to any PIC "of an aircraft carrying persons OR of an aircraft certificated for more than one pilot flight crewmember" — i.e. essentially every jet in this product's market, including an empty repositioning leg with nobody aboard, not just passenger flights. 61.57(a) itself has no time-of-day restriction; 61.57(b) layers an *additional* night requirement on top, it doesn't replace (a).

#### `courses_intercepted_tracked`
`boolean`, not null, default `false`. Whether this flight included 61.57(c)(1)(iii)'s "intercepting and tracking courses through the use of navigational electronic systems" — a required instrument-currency task the schema previously had no field for at all. Modeled as a boolean, not a count, because the regulation states it as a task performed on a flight rather than a number of repetitions (unlike `holds`, which is a count on purpose, for the opposite reason).

#### `view_limiting_pilot_name`
`text`, nullable. 61.51(b)(1)(v) requires logging "the name of a safety pilot, if required by [14 CFR] 91.109." Nullable because a safety pilot is only required on a subset of simulated-instrument flights — the app surfaces this field as a prompt when `instrument_simulated_time > 0`, since the schema itself can't evaluate whether 91.109 applies to a given flight.

#### `approach_condition`
`text`, nullable. One of `actual`, `simulated`, `neither` when set. Records whether an approach was flown "in actual weather conditions, or under simulated conditions using a view-limiting device," as 61.57(c)(1) requires — a fact the schema had no way to record before this column existed. `'neither'` is a real, pilot-asserted, disqualifying fact (e.g. a visual approach flown in clear VMC with no hood), distinct from `NULL`. `NULL` means unknown, and every pre-existing row reads as `NULL` — the currency engine is designed to treat a missing `approach_condition` as excluded from the qualifying count, never as either a positive or a negative signal on its own.

#### `sole_manipulator`
`boolean`, nullable. Whether the pilot acted as sole manipulator of the flight controls, per 61.57(a)(1)(i)/(b)(1)(i) and 135.247(a). `NULL` means unrecorded and must never be read as `false` — `role` (PIC/SIC/SOLO/DUAL_RECEIVED) is not a substitute for this fact.

#### `night_window_asserted`
`boolean`, nullable. Whether the pilot is asserting that a takeoff/landing on this entry fell inside 61.57(b)(1)/135.247(a)(2)'s specific window (1 hour after sunset to 1 hour before sunrise) — a narrower window than `night_time`'s civil-twilight definition. `NULL` means not asserted.

### Notable constraints

RLS is enabled. Several enum-style CHECK constraints (`source`, `role`, `simulator_device_type`, `approach_type`, `approach_condition`) restrict those columns to fixed vocabularies. Every time-of-time-category and count column has a non-negative CHECK. `from_icao`/`to_icao` are regex-constrained to 3–4 alphanumeric characters.

The most important constraint here is `logbook_entries_role_required_unless_simulator`: `role is not null OR (simulator_time > 0 AND total_time = simulator_time)`. In plain terms, an entry must name a crew role unless the entry is entirely simulator time — mixing real flight time with simulator time on one row still requires a role, because in that case someone was flying an actual aircraft.

`airman_user_id` is writable by `authenticated` on `INSERT` but not on `UPDATE` — once set (server-side, from the session), it can't be changed through the app, which keeps a multi-pilot account's rows from being reattributed to a different pilot after the fact.

### Changing this table

This is a legal record — treat hand-edits as data repair, not routine maintenance, and be conservative about it. `authenticated` (the app) can insert and update most flight-detail columns but never `airman_user_id`, `id`, `created_at`, `updated_at`, `foreflight_sync_id`, `row_fingerprint`, `source_row`, or `source_row_number` after insert. The SQL Editor bypasses all of that — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for why, and wrap any correction in a transaction you inspect before committing.

```sql
begin;
update pilot.logbook_entries
set night_landings_full_stop = 2
where account_id = '<account-uuid>' and id = '<entry-uuid>';
select * from pilot.logbook_entries where id = '<entry-uuid>';
rollback; -- or commit;
```

## operator_qualifications

This table records what a Part 135 operator (a client, in this schema's terms) has told or shown the pilot about their qualification status on that operator's certificate — things like a written test, a competency check, an instrument proficiency check, a line check, drug-and-alcohol program status, or manuals acknowledgment. It exists because a contract pilot flying for a Part 135 operator has to be qualified under that specific operator's certificate, separately from being personally typed and current — and nothing in this product tracked that before this table.

This is worth being precise about: this table is explicitly **not** a determination that the pilot is on the operator's certificate, and it is not a determination of regulatory compliance. The dates it holds are a planning aid the pilot recorded, not something this product verifies or vouches for. Two of the requirement kinds in particular — drug/alcohol program status and PRD (Pilot Records Database) consent — bind the *operator* or the pilot's own consent action under 14 CFR 120.105/120.215 and 111.310/111.120, and this product never computes or verifies either.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`.

#### `account_id`
`uuid`, not null. Tenant owner. Foreign key to `pilot.accounts(id)`.

#### `client_id`
`uuid`, not null. Which client — i.e. which operator — this qualification is held under. There's no separate `operators` table in this schema; a client *is* the operator. Composite foreign key `(account_id, client_id)` into `pilot.clients`.

#### `requirement`
`text`, not null. One of `basic_indoc`, `initial_training`, `recurrent_training`, `written_test_135_293a`, `competency_check_135_293b`, `ipc_135_297`, `line_check_135_299`, `drug_alcohol_program_120`, `prd_consent_111`, `insurance_approval`, `company_manuals`, `other`. Which specific qualification requirement this row tracks.

#### `completed_on`
`date`, nullable. When this requirement was completed, as the pilot recorded it.

#### `status`
`text`, not null, default `'not_started'`. One of `not_started`, `in_progress`, `current`, `lapsed`, `n_a`.

#### `expires_on`
`date`, nullable. The column name is load-bearing: `pilot.expiration_coverage_gaps()` finds date-bearing expiry tables by this exact column name, so it has to be spelled exactly this way for the row to appear on the app's expiration ladder. For four specific requirement kinds — `written_test_135_293a` (12 calendar months, 135.293(a)), `competency_check_135_293b` (12 calendar months, 135.293(b), class/type-specific), `ipc_135_297` (6 calendar months, 135.297(a), type-specific with a rotation rule under (e)), and `line_check_135_299` (12 calendar months, 135.299(a), *not* type-specific — one check in any one type covers every type) — this value is computed server-side by `pilot.compute_operator_qualification_expiry()`, with 135.301(a)'s one-month-early/one-month-late grace provision applied on update. For every other requirement kind, this is a plain pilot-entered date or null; there's no calendar-month regulation cited for those, and the drug/alcohol and PRD-consent kinds are status this product doesn't compute a determination for at all.

#### `type_designator`
`text`, not null, default `''`. Aircraft class/type designator (e.g. `CE-560XL`). Required to be non-blank only for `competency_check_135_293b` and `ipc_135_297` — 135.293(b) is class/type-specific, and 135.297(e) rotates by type when a pilot is assigned more than one, so those two requirement kinds are repeatable, one row per class/type. For every other requirement, including `line_check_135_299`, it's optional and purely informational — a 135.299(a) line check is satisfied by one check in any one type, so its `type_designator` just records which type that happened to be, not a separate per-type requirement. A prior version of this table had this exactly backwards (see Notable constraints); it was corrected in a later migration.

#### `notes`
`text`, nullable. Free-text notes.

#### `document_id`
`uuid`, nullable. Links to a supporting document, if the pilot attached one. Composite foreign key `(account_id, document_id)` into `pilot.documents`.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled. `requirement` and `status` are each restricted to fixed vocabularies by CHECK. A composite foreign key ties `client_id` to `pilot.clients`, and another ties `document_id` to `pilot.documents`, both tenant-scoped through `account_id`.

Worth knowing if you ever look at old data or old migration history: the original version of this table had its type-specificity model backwards — it forced a non-blank `type_designator` on the line check (which doesn't need one) and stayed silent on the competency check and IPC (which do). A dedicated migration corrected the model, migrated existing rows, and rewrote every comment that repeated the wrong reasoning. If you're reading a migration file older than that correction, don't trust its description of which requirement kinds are type-specific.

`expires_on` is computed by a trigger function for four requirement kinds and is otherwise a plain pilot-entered value — the trigger doesn't validate that a pilot entered a sensible `completed_on` for the other kinds, it only computes forward from it for the four calendar-month-governed ones.

### Changing this table

Editable via normal grants — `authenticated` can insert/select/update `completed_on`, `document_id`, `expires_on`, `notes`, `status`, and `type_designator`. Be careful hand-editing `expires_on` for the four trigger-computed requirement kinds: the app relies on the trigger's calendar-month arithmetic (including the 135.301(a) early/late grace), and a hand-typed date can silently disagree with what the trigger would have computed from `completed_on`. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

```sql
begin;
update pilot.operator_qualifications
set status = 'current', completed_on = '2026-06-15'
where account_id = '<account-uuid>' and id = '<qualification-uuid>';
rollback; -- or commit;
```

## aircraft

The pilot's own fleet: one row per airframe, keyed on a normalized tail number so that `N447SP`, `N-447SP`, and `n447sp` can't become three separate aircraft records. This table exists because time in a specific make/model/type is what an insurance underwriter's pilot-history form asks for and what a chief pilot asks about on the phone before offering a trip — and before this table existed, `aircraft_ident`/`aircraft_type` were retyped as free text on every trip and every logbook entry, with no rollup possible.

Important: this table only *annotates* history. It never rewrites `pilot.logbook_entries`, which — as covered above — is a legal record under 61.51. Normalization (matching `N447SP` and `N-447SP` as the same aircraft) happens at read time, by joining on the generated `tail_key` column, not by editing what the pilot originally logged.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`.

#### `account_id`
`uuid`, not null. Tenant owner. Foreign key to `pilot.accounts(id)`.

#### `tail_number`
`text`, not null, length between 2 and 12 characters after trimming. The tail number as the pilot writes it, and what's rendered back to them.

#### `tail_key`
`text`, generated column, computed as `upper(regexp_replace(tail_number, '[^A-Za-z0-9]', '', 'g'))`, stored. This is what every join and uniqueness check actually uses — case-folded and punctuation-stripped, so `N447SP`/`N-447SP`/`n447sp` all normalize to the same key. Being a generated column means it can never drift out of sync with `tail_number`; no code path can forget to maintain it. Must be non-empty (a tail number of nothing but punctuation would otherwise normalize to `''` and collide across the whole account).

#### `type_designator`
`text`, nullable, must match `^[A-Z0-9]{2,4}$` when present. The ICAO type designator (e.g. `C560`, `BE40`, `PC12`). Optional deliberately — a pilot may add an aircraft before knowing its exact designator, and a wrong value on an underwriter-facing form is worse than a blank one.

#### `type_rating`
`text`, nullable, must match `^[A-Z0-9-]{2,10}$` when present. The FAA type rating, which is a different, coarser grouping than the ICAO designator — one `CE-500` rating covers six different Cessna models that ICAO splits into five separate designators. This is what the app's time-by-type rollup groups on, and what 61.57(a)(1)(ii)'s "same type" language is actually written in terms of.

#### `make_model`
`text`, nullable. Free-text make/model description.

#### `gear`
`text`, nullable. One of `tricycle`, `tailwheel`, `skid`, `float`, `ski` when set. Matters because 61.57(a)(1)(ii) requires the three required takeoffs *and* landings to be made to a full stop specifically when the aircraft flown is a tailwheel airplane — and this requirement is not day-scoped, it applies at any time of day. `NULL` means not recorded and must not be read as tricycle.

#### `category_class`
`text`, nullable. Free-text category/class.

#### `notes`
`text`, nullable. Free-text notes.

#### `archived_at`
`timestamptz`, nullable. When set, this aircraft is treated as archived/retired from the active fleet rather than deleted.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`.

#### `is_turbine`
`boolean`, nullable. Whether the airframe is turbine-powered — relevant to 61.57(e)(4)'s turbine multi-crew night alternative and its sub-paragraphs. Not currently read by any shipped module; recorded for a future currency-engine phase. `NULL` means not recorded.

#### `certificated_more_than_one_pilot`
`boolean`, nullable. Whether the aircraft is type-certificated for more than one required pilot flight crewmember. Decides whether 61.57(a) binds on an empty repositioning leg at all (see 61.57(a)(1)'s "carrying persons OR certificated for more than one pilot flight crewmember" language). `NULL` means not recorded.

#### `is_retractable`
`boolean`, nullable. Whether this airframe has retractable landing gear — a fact insurance pilot-history forms and open-pilot warranties ask for separately from `gear`, which records tricycle/tailwheel/skid/float/ski (a different axis entirely — a Bonanza is tricycle *and* retractable; a Super Cub is tailwheel *and* fixed). `NULL` means not recorded and must never be read as fixed-gear.

#### `client_id`
`uuid`, nullable. Which client this airframe belongs to or is flown for — a fact about the aircraft itself, not about any one trip (an aircraft can be flown on trips for different clients while still having one owner/managing client on file). Composite foreign key `(account_id, client_id)` into `pilot.clients`, `ON DELETE RESTRICT` — a client with a registered aircraft on file can't be deleted until the aircraft's `client_id` is cleared or reassigned. `NULL` means either nobody has said who owns it, or it's a freelance-fleet tail (an FBO rental, a school trainer, a demo aircraft) that belongs to no client at all — never read as an assertion either way.

### Notable constraints

RLS is enabled. `tail_number`'s length CHECK and `tail_key`'s non-empty CHECK together prevent both malformed tail numbers and the edge case of a tail number that normalizes to an empty string. `type_designator` and `type_rating` are each regex-constrained to plausible formats. `gear` is restricted to a fixed vocabulary. The `client_id` foreign key is `ON DELETE RESTRICT`, matching the same pattern `pilot.trips.client_id` uses.

### Changing this table

Editable via normal grants for the descriptive columns — `authenticated` can insert/select/update everything except `id`, `tail_key` (generated, can't be written directly), `created_at`, and `updated_at`. Because `tail_key` is generated from `tail_number`, changing `tail_number` by hand will automatically recompute it — you don't (and can't) set `tail_key` yourself. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

```sql
begin;
update pilot.aircraft
set gear = 'tailwheel', is_retractable = false
where account_id = '<account-uuid>' and id = '<aircraft-uuid>';
rollback; -- or commit;
```

## currency_snapshots

One computed currency verdict, for one airman, for one currency type, as of one evaluation date. This table is append-only by design: a snapshot is a record of what the currency engine computed at a particular moment from the logbook entries visible to it at that moment. If a logbook entry is later corrected — a landing count fixed, an aircraft's gear recorded, a role corrected — the right response is to compute a *new* snapshot, never to edit an old one in place. An old snapshot staying exactly as it was computed is the point: it's a record of "here's what the engine said on this date, from these inputs," not a live-updating field.

`currency_type` and `status` are drawn verbatim from the vocabulary locked in `docs/CURRENCY-SPEC.md`. `rule_basis` exists because the same underlying landings can produce different verdicts depending on which regulation is being applied — 61.57(b) and 135.247(a)(2) reach different answers from the same night landings (61.57(b) requires full-stop landings; 135.247(a)(2) does not), so the row has to record which rule produced its arithmetic.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`.

#### `account_id`
`uuid`, not null. Tenant owner. Foreign key to `pilot.accounts(id)`.

#### `airman_user_id`
`uuid`, not null. Whose currency this snapshot is about. Foreign key to `auth.users(id)`. Currency is a per-airman duty under 61.57/61.56, and a business account can have more than one pilot seat — keying only on `account_id` would let a two-pilot account's landings sum into one verdict that's true of neither pilot.

#### `currency_type`
`text`, not null. One of `passenger_day`, `passenger_night`, `instrument`, `flight_review`, `medical`. Note that `passenger_day`/`passenger_night` are legacy labels the spec locks in as internal identifiers — 61.57(a) itself is not actually passenger-only or day-only (it can reach an empty repositioning leg with no time-of-day limit); the *display* label a pilot sees is generated separately and never comes straight from this column.

#### `status`
`text`, not null. One of `estimated_current`, `estimated_not_current`, `insufficient_data` — deliberately hedged language. There is no "expiring soon" state; how close a date is to lapsing is treated as a rendering concern, not a stored status.

#### `rule_basis`
`text`, not null. One of `61.57(a)`, `61.57(b)`, `61.57(c)`, `61.56`, `61.23`, `135.247(a)(1)`, `135.247(a)(2)`. Which specific regulation's arithmetic produced this row.

#### `as_of`
`date`, not null. The evaluation date this snapshot is computed as of.

#### `window_start` / `window_end`
`date`, both nullable. The lookback window's start and end dates, when the computation used one (a CHECK requires `window_end >= window_start` when both are present).

#### `through_date`
`date`, nullable. The derived "valid through" date for 61.56-style calendar-month computations. Deliberately not named `expires_on`: `pilot.expiration_coverage_gaps()` finds date-bearing tables by that exact column name, and a currency computation is not a document with an expiry — it shouldn't appear on the same due-soon reminder ladder as an actual expiring document.

#### `limiting_item`
`text`, nullable. Which specific fact limited the verdict (e.g. which count fell short).

#### `limiting_date`
`date`, nullable. The date associated with the limiting item.

#### `counts`
`jsonb`, not null, default `{}`. Structured detail of what was required versus what was observed (e.g. `{required: {...}, observed: {...}}`), so the app can render the underlying arithmetic rather than just a verdict.

#### `counted_entry_ids`
`uuid[]`, not null, default `{}`. The specific `logbook_entries` rows that fed into this computation — lets the app show a pilot exactly which entries were counted.

#### `missing_inputs`
`text[]`, not null, default `{}`. Which specific inputs were missing, when `status = 'insufficient_data'`.

#### `limitations`
`text`, not null, must be non-blank after trimming. Holds the counsel-reviewed currency disclaimer, stored on every row so no rendering path can ever separate the caveat from the number. `NOT NULL` alone wouldn't be sufficient here — an empty string is not null and would separate the disclaimer from the data just as effectively as a null would; the additional non-blank CHECK is what actually closes that gap.

#### `computed_at`
`timestamptz`, not null, default `now()`. When the engine actually computed this row (as distinct from `as_of`, the date it was computed *for*).

#### `created_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled. `currency_type`, `status`, and `rule_basis` are each restricted to fixed vocabularies by CHECK. `window_end >= window_start` is enforced when both are present. Two CHECKs work together to enforce a "insufficient_data must explain itself" rule: `status <> 'insufficient_data' OR cardinality(missing_inputs) > 0` and `status = 'insufficient_data' OR cardinality(missing_inputs) = 0` — an insufficient-data row must name at least one missing input, and a computed row must name none. `limitations` carries a non-blank CHECK on top of `NOT NULL` for the reason described above.

There's no `UPDATE` grant for `authenticated` on this table at all (only `INSERT` and `SELECT`) — this is the mechanism, not just a convention, that enforces append-only: the app literally cannot update an existing snapshot row through its normal grants, only insert a new one.

### Changing this table

Do not hand-correct a snapshot row. The table's entire design point is that a wrong or stale verdict gets fixed by computing a new snapshot from current logbook data, not by editing the old one — an edited-in-place row stops being an honest record of what was computed and when. If a snapshot is simply wrong and needs to disappear (e.g. a bug produced garbage), delete it rather than edit it, and let the engine recompute. The SQL Editor can bypass the missing `UPDATE` grant entirely since it runs as an admin role — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) — which is exactly why this is worth stating plainly rather than assuming the schema will stop you.

```sql
begin;
delete from pilot.currency_snapshots
where account_id = '<account-uuid>' and id = '<snapshot-uuid>';
rollback; -- or commit;
```
