# Phase 7 — Currency engine specification

**Status: for review. Flag stays off.** This document is the gate named in `docs/PLAN.md`
Decision #15 and the standing gates: Tony reviews this spec, aviation counsel reviews the
disclaimer, and only then does the currency flag get enabled. Nothing here proposes changing
that sequence.

**Every regulation quoted below was fetched from the eCFR versioner API at issue date
2026-08-05 on 2026-08-07.** The fetch URL is printed with each requirement. Where a reading is
interpretive rather than plain text, it says so and names what would settle it. Three things in
the brief this spec was written against turned out to be wrong against the current text; they
are called out inline and summarised in §10.

---

## 1. Scope and posture

**What the engine does:** reads `pilot.logbook_entries` and `pilot.documents` rows the pilot
entered themselves, applies the arithmetic in §2 to them, and displays one of three hedged
states per currency type with the arithmetic shown.

**What the engine does not do:** determine regulatory compliance, determine whether a specific
flight may legally be conducted, model duty and rest, model medical duration, or reach any
conclusion about data it cannot see. It is a planning aid over the pilot's own records.

How the posture is held in the output wording, concretely:

| Mechanism | Why |
|---|---|
| The state names are `estimated_current` / `estimated_not_current` / `insufficient_data` — never `current` / `legal` / `compliant` | "Estimated" is the whole claim. Ported verbatim from the vocabulary `docs/PLAN.md` locks. |
| Every state renders with the limiting item and the dates that produced it | A pilot hand-checks the math in week one. Visible arithmetic is what makes the hedge honest rather than defensive. |
| `insufficient_data` is the default, not the fallback | Any missing input that *could* change the answer produces it. See §6. |
| The disclaimer (`CURRENCY_DISCLAIMER`, §7) travels with the snapshot — `currency_snapshots.limitations` stays NOT NULL | Already the plan's design. It means the caveat cannot be separated from the number by any rendering path. |
| No output ever says "you may fly" | Currency is one input to that question. The engine sees one of several. |

One structural fact governs everything below: **there is no airman record.** `pilot.accounts`
is a billing entity; `account_members` joins a person to it; `logbook_entries.airman_user_id`
says whose logbook a row is. Nothing records certificates, ratings, category/class, or type
privileges, and no aircraft record exists at all — `trips.aircraft_ident` /
`aircraft_type` and `logbook_entries.aircraft_ident` / `aircraft_type` are free text. Almost
every `insufficient_data` in §6 traces back to this.

---

## 2. Currency types, with exact math

### 2.1 — 61.57(a) general experience

Fetched: `https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.57`

> (a) *General experience.* (1) Except as provided in paragraph (e) of this section, no person
> may act as a pilot in command of an aircraft carrying persons or of an aircraft certificated
> for more than one pilot flight crewmember unless that person has made at least three takeoffs
> and three landings within the preceding 90 days, and—
> (i) The person acted as the sole manipulator of the flight controls; and
> (ii) The required takeoffs and landings were performed in an aircraft of the same category,
> class, and type (if a class or type rating is required), and, if the aircraft to be flown is
> an airplane with a tailwheel, the takeoffs and landings must have been made to a full stop in
> an airplane with a tailwheel.

Three things this text settles that the product's older comments got wrong (already corrected
in `20260807120000_logbook_reg_corrections.sql`, section C):

1. It is **not "passenger currency."** The trigger is "carrying persons **or** of an aircraft
   certificated for more than one pilot flight crewmember." Every two-crew-certificated jet in
   this product's market is inside (a) on an empty repositioning leg with nobody aboard.
2. It is **not day-only.** (a) has no time-of-day limit. 61.57(b) adds a night requirement on
   top; it does not replace (a).
3. **Full stop is required only for tailwheel airplanes**, per (a)(1)(ii). For everything else
   a touch-and-go landing counts.

Also relevant: (a)(2) lets a pilot act as PIC under day VFR or day IFR to *regain* the
experience "provided no persons or property are carried on board the aircraft, other than those
necessary for the conduct of the flight." The engine does not need this to compute a state; it
needs it for the "how do I fix this" copy.

**Inputs required**

| Input | Exists today? |
|---|---|
| `entry_date` | Yes |
| `day_takeoffs` + `night_takeoffs` | Yes — added by `20260807120000`. **The brief's claim that no takeoff count is recorded is stale.** |
| `day_landings_full_stop`, `day_landings_touch_go`, `night_landings_full_stop`, `night_landings_touch_go` | Yes |
| Sole manipulator of the controls on that entry | **No column.** `role` (now `PIC`/`SIC`/`SOLO`/`DUAL_RECEIVED` — widened by `supabase/migrations/20260809000000_logbook_role_vocabulary.sql`) is still not the same fact — an SIC can be the sole manipulator, and a PIC in a two-crew aircraft may not have been. The widened vocabulary does not close this gap; it makes one direction of it explicit for a case the old two-value vocabulary could not represent at all — see the next row. |
| Whether the entry is DUAL_RECEIVED (training received, not acting as PIC) | **New, as of the same migration.** `role = 'DUAL_RECEIVED'` is a reliable *negative* signal for 61.57(a)/(b): a row logged that way records the pilot receiving instruction under 61.51(h), not acting as pilot in command, so it must never be counted toward (a)/(b) recency even though it may sit inside the lookback window and even though the SAME row's `total_time` reflects real flying. Note the asymmetry with `role = 'PIC'`: a PIC row can carry `dual_received_time > 0` on the same row (recurrent training, sole-manipulator PIC per 61.51(e)(1)(i) while also receiving instruction per 61.51(h) — see the migration header) and such a row's role stays `PIC`, so it is NOT excluded by this rule. The exclusion is keyed on `role`, not on whether `dual_received_time` is non-null. |
| Category, class, and type of the aircraft flown | **No.** Free-text `aircraft_type` only. |
| Category/class/type of the aircraft *to be flown* | **No.** There is no "intended flight" input at all. |
| Whether the aircraft is a tailwheel airplane | **No flag.** |
| Whether the aircraft is certificated for more than one pilot flight crewmember | **No flag** — needed to know whether (a) even binds on an empty leg. |
| Simulator device class + approval + part 142 course (see §4) | Partly: `simulator_device_type` exists; the approval and course facts do not. |

**Computation**

```
takeoffs(entry) = day_takeoffs + night_takeoffs
landings(entry) = day_landings_full_stop + day_landings_touch_go
                + night_landings_full_stop + night_landings_touch_go
   -- if the aircraft is a tailwheel airplane, only *_full_stop count.

window   = entries where entry_date between (flight_date - 89 days) and flight_date
           and role <> 'DUAL_RECEIVED'
           and sole_manipulator is true
           and matches category/class/type of the aircraft to be flown
current  = sum(takeoffs) >= 3 and sum(landings) >= 3
```

The `role <> 'DUAL_RECEIVED'` clause is a cheap, reliable pre-filter available today (see the inputs
table above); it is not a substitute for `sole_manipulator`, which still gates the window on its own
once that column exists. Whether a `role = 'SOLO'` entry should pass this filter is **left open** —
see O-6 below; the pseudocode above deliberately does not exclude `SOLO`, matching the "ambiguity
resolves against permissiveness" rule this document already applies to the 90-day boundary, but a
solo entry is asserted, not derived, to be sole-manipulator PIC time and this document has not
verified that reading against 61.51(e)(4)/(d) closely enough to state it as settled.

**The 90-day boundary is a stated choice, not a derived one.** The reg says "within the
preceding 90 days" without saying whether the 90th day back is inside or outside. The engine
uses the conservative reading — the earliest qualifying date for a 07 AUG 2026 flight is
10 MAY 2026, not 09 MAY 2026 — because ambiguity resolves against permissiveness
(`product-translation.md` §3.6). An FAA Chief Counsel interpretation on the boundary would
settle it; none was retrieved for this pass. **Flag it in the UI**: a pilot whose only
qualifying landing is exactly 90 days old will be told the boundary is being read
conservatively rather than silently marked not-current.

**Output states**

- `estimated_current` — all inputs present, thresholds met.
- `estimated_not_current` — all inputs present, thresholds not met.
- `insufficient_data` — any of: no sole-manipulator field (today: always), no category/class of
  the entries, no tailwheel flag on an aircraft whose type is unknown, no intended aircraft.
  **Today this is the only reachable state for 61.57(a).**

### 2.2 — 61.57(b) night takeoff and landing experience

Same fetch URL as §2.1.

> (b) *Night takeoff and landing experience.* (1) Except as provided in paragraph (e) of this
> section, no person may act as pilot in command of an aircraft carrying persons during the
> period beginning 1 hour after sunset and ending 1 hour before sunrise, unless within the
> preceding 90 days that person has made at least three takeoffs and three landings **to a full
> stop** during the period beginning 1 hour after sunset and ending 1 hour before sunrise, and—
> (i) That person acted as sole manipulator of the flight controls; and
> (ii) The required takeoffs and landings were performed in an aircraft of the same category,
> class, and type (if a class or type rating is required).

**The single most dangerous silent error available in this product** is treating `night_time`
and the (b) window as the same clock. They are not:

Fetched: `https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=1.1`

> *Night* means the time between the end of evening civil twilight and the beginning of morning
> civil twilight, as published in the Air Almanac, converted to local time.

Civil twilight ends roughly 25–35 minutes after sunset depending on latitude and season, so
there is a window — typically 25 to 35 minutes long — in which a landing is **1.1-night**
(correctly logged as `night_time`) and **not inside the 61.57(b) window**. A pilot who fills
`night_landings_full_stop` from "the leg was at night" over-states night currency. The column
comments in `20260807120000` already say this and the form hints already say this; the engine
must repeat it at the point the state is displayed, because the engine is the first surface
that turns those numbers into a claim.

Two further points the text settles:

- (b) binds only when **carrying persons**. Unlike (a), an empty night repositioning leg in a
  two-crew jet does not require (b) currency. The engine must not present night currency as a
  gate on flights it does not gate — but it also cannot know whether persons will be aboard, so
  the display is "required when carrying persons at night," never "you may not fly tonight."
- **Full stop is required for every aircraft here**, not only tailwheel. `night_landings_touch_go`
  never counts.

**Inputs**: `night_takeoffs`, `night_landings_full_stop`, `entry_date`, plus the same
sole-manipulator and category/class/type inputs as §2.1, plus (critically) a field asserting
that the takeoff/landing was inside the **1-hour-after-sunset to 1-hour-before-sunrise** window
rather than merely 1.1-night. The current columns are documented as meaning the (b) window,
which makes the assertion the pilot's — that is the right place for it, but the engine must
show what it assumed.

**Computation**: identical shape to §2.1 with `full_stop` only, over the same conservative
90-day window.

**Output states**: as §2.1. Additional `insufficient_data` trigger: any entry in the window
where `night_time > 0` but `night_takeoffs = 0 and night_landings_full_stop = 0` produces a
*note*, not a state change — that pattern is legitimate (a night flight with a daytime landing)
and treating it as missing data would make the state permanently unresolvable for most pilots.

### 2.3 — 61.57(c) instrument experience

Same fetch URL as §2.1.

> (c) *Instrument experience.* Except as provided in paragraph (e) of this section, a person may
> act as pilot in command under IFR or weather conditions less than the minimums prescribed for
> VFR only if:
> (1) *Use of an airplane, powered-lift, helicopter, or airship for maintaining instrument
> experience.* Within the 6 calendar months preceding the month of the flight, that person
> performed and logged at least the following tasks and iterations in an airplane, powered-lift,
> helicopter, or airship, as appropriate, for the instrument rating privileges to be maintained
> in actual weather conditions, or under simulated conditions using a view-limiting device that
> involves having performed the following—
> (i) Six instrument approaches.
> (ii) Holding procedures and tasks.
> (iii) Intercepting and tracking courses through the use of navigational electronic systems.

**Correction to the brief:** `courses_intercepted_tracked` (boolean) **does exist** — added by
`20260807120000` section D, precisely because `docs/PLAN.md` flagged the gap. 61.57(c) is closer
to computable than the brief assumes. What still blocks it is narrower and listed below.

**Inputs**

| Input | Exists? |
|---|---|
| `approaches_count`, `approach_type` | Yes |
| `holds` | Yes |
| `courses_intercepted_tracked` | Yes |
| Whether the approaches were in **actual weather conditions or under simulated conditions using a view-limiting device** | **No.** `instrument_actual_time` / `instrument_simulated_time` are hours, not a per-approach condition. An approach flown in VMC with no hood, tagged `ils`, is indistinguishable in the schema from one flown in IMC. **This is the live blocker on 61.57(c).** |
| Category of aircraft, matched to the instrument rating privileges being maintained | **No.** |
| Device class for simulator credit | `simulator_device_type` yes; "represents the category" no |

A row tagged `approach_type = 'visual'` does **not** satisfy (c)(1)(i) — a visual approach is
flown in neither actual weather conditions nor under a view-limiting device. This reading rests
on the plain text; no Chief Counsel interpretation was retrieved. `approaches_count` does not
itself exclude visual rows (see the column comment), so the engine must join on `approach_type`
and exclude `'visual'`, and must treat `approach_type IS NULL` as **not counted**, since an
untyped approach cannot be shown to qualify.

**Computation** (calendar months — see §3):

```
window_start = date_trunc('month', flight_date) - interval '6 months'
window       = entries where entry_date >= window_start and entry_date <= flight_date
approaches   = sum(approaches_count) over window rows where approach_type not in ('visual')
                                                        and approach_type is not null
                                                        and approach_condition in ('actual','simulated')   -- NEW FIELD
holding      = exists(row in window with holds > 0)
intercept    = exists(row in window with courses_intercepted_tracked)
current      = approaches >= 6 and holding and intercept
```

`holds` is a count and `courses_intercepted_tracked` is a boolean, matching how the reg states
them: (c)(1)(ii) is silent on repetition, (c)(1)(iii) is a task performed. The engine requires
each at least once in the window; it does not require them on the same flight, and the text does
not say they must be.

**Output states**: `insufficient_data` today (no approach-condition field). After that field
ships: current / not-current as above, with `insufficient_data` retained whenever category is
unknown and the pilot holds more than one category rating — which, absent an airman record, is
always. See §9.

### 2.4 — 61.57(d) instrument proficiency check

Same fetch URL as §2.1.

> (d) *Instrument proficiency check.* (1) Except as provided in paragraph (e) of this section, a
> person who has failed to meet the instrument experience requirements of paragraph (c) of this
> section for more than six calendar months may reestablish instrument currency only by
> completing an instrument proficiency check.

**Correction to the brief, and it matters.** The brief describes "the 6-month and 12-month
structure." **The current text contains no 12-month element.** The retrieved 2026-08-05 text of
(d) has exactly one threshold: lapse of more than six calendar months → IPC is the only way
back. The two-stage structure (regain by performing the (c) tasks with a safety pilot inside a
grace window, IPC only after a further period) is not in this text. Do not build to the brief's
description. If someone has a source for the two-stage reading, it is either a prior amendment
or a different section, and it must be produced before any code depends on it.

(d)(2) constrains where the IPC may be given — aircraft appropriate to the category, or for
other than a glider "in a full flight simulator or flight training device that is representative
of the aircraft category." (d)(3) constrains who may give it, including "(iii) A company check
pilot who is authorized to conduct instrument flight tests under part 121, 125, or 135 … provided
that both the check pilot and the pilot being tested are employees of that operator" — which is
the ordinary path for this product's Part 135 users and connects to `operator_qualifications`'
`ipc_135_297` rows.

**What the engine does with (d): nothing computational.** Determining "has failed to meet (c)
for more than six calendar months" requires knowing when the lapse *started*, which requires a
complete instrument history — and an imported logbook that starts in 2019 cannot distinguish
"never current" from "current, with the qualifying flights logged elsewhere." The engine
therefore:

- computes 61.57(c) as in §2.3;
- when not current, displays the (d) pathway as **informational text**, naming that an IPC may
  be required if the lapse exceeds six calendar months, and that the engine does not compute
  which path applies;
- never emits a state that asserts an IPC is or is not required.

An IPC recorded under `operator_qualifications.ipc_135_297` is a **135.297** check on an
operator's certificate. Whether a given 135.297 check also satisfies 61.57(d) depends on how it
was conducted and by whom — plausible in most cases, not determinable from a date and a
requirement key. The engine does not cross-credit them. Settling this needs the operator's
OpSpecs and training program, or counsel.

### 2.5 — 61.57(e)(3), the Part 135 exemption

Same fetch URL as §2.1.

> (3) This section does not apply to a pilot in command who is employed by a part 119 certificate
> holder authorized to conduct operations under part 135 when the pilot is engaged in a flight
> operation under parts 91 or 135 for that certificate holder if the pilot in command is in
> compliance with §§ 135.243 and 135.247 of this chapter.

Note the scope: **"This section does not apply"** — the whole of 61.57, not merely (a) and (b).
Contrast (e)(1), which disapplies only paragraphs (a) and (b) for the part 125 case. That
difference is in the text and is not a drafting accident to smooth over.

**The exemption is not a free pass**, because 135.247 imposes its own recency:

Fetched: `https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=135.247`

> (a) No certificate holder may use any person, nor may any person serve, as pilot in command of
> an aircraft carrying passengers unless, within the preceding 90 days, that person has—
> (1) Made three takeoffs and three landings as the sole manipulator of the flight controls in an
> aircraft of the same category and class and, if a type rating is required, of the same type in
> which that person is to serve; or
> (2) For operation during the period beginning 1 hour after sunset and ending 1 hour before
> sunrise (as published in the Air Almanac), made three takeoffs and three landings during that
> period as the sole manipulator of the flight controls in an aircraft of the same category and
> class and, if a type rating is required, of the same type in which that person is to serve.
> A person who complies with paragraph (a)(2) of this section need not comply with paragraph
> (a)(1) of this section.

Two differences from 61.57 worth encoding: 135.247(a) binds only when **carrying passengers**,
and (a)(2) night landings are **not required to be to a full stop** in this text — unlike
61.57(b)(1). Complying with the night variant satisfies the day variant.

**How the engine uses the operating-rule field** (owner has approved adding it to both the
client and the trip):

```
operating_rule ∈ ('part_91', 'part_135', 'unspecified')      -- on clients (default) and trips (per-trip override)
part_135_employer_exemption_asserted  boolean                 -- on the client only; pilot's own assertion
```

Branch:

| Operating rule | Exemption asserted | Engine behaviour |
|---|---|---|
| `part_135` | yes | Computes **135.247** recency instead of 61.57(a)/(b), and displays 61.57 results as "may not apply — see 61.57(e)(3)" rather than hiding them. Never suppresses a not-current result; it re-labels it. |
| `part_135` | no | Computes 61.57 normally; surfaces (e)(3) as an available path the pilot has not asserted. |
| `part_91` | either | Computes 61.57 normally. (e)(3) can still reach part 91 flying **for that certificate holder** — so if asserted, the same re-labelling applies, since the text says "under parts 91 or 135 for that certificate holder." |
| `unspecified` | either | `insufficient_data`. See §5. |

**The exemption is asserted, never inferred, and this is a counsel question, not a product
one.** (e)(3) says "**employed by** a part 119 certificate holder." This product's entire user
base is 1099 contract pilots who are, as a matter of tax and contract law, generally *not*
employees of the operators they fly for. Whether "employed by" in 61.57(e)(3) reaches a contract
pilot flying on an operator's certificate under that operator's training program is exactly the
kind of question this product must not answer. The engine therefore never turns the exemption on
by itself, and the UI copy for the assertion must not imply the product has assessed it. What
would settle it: an FAA Chief Counsel interpretation on "employed by" as used in 61.57(e), or
the operator's OpSpecs and counsel's read of the specific contract. **Counsel question C-2.**

### 2.6 — 61.57(e)(4), the turbine multi-crew night alternative

*Specified now, built later, at the owner's explicit request. Verified line by line against the
text; the brief's summary was accurate except where noted.*

Same fetch URL as §2.1.

> (4) Paragraph (b) of this section does not apply to a pilot in command of a turbine-powered
> airplane that is type certificated for more than one pilot crewmember, provided that pilot has
> complied with the requirements of paragraph (e)(4)(i) or (ii) of this section:

Both (i) and (ii) open identically:

> The pilot in command must hold at least a commercial pilot certificate with the appropriate
> category, class, and type rating for each airplane that is type certificated for more than one
> pilot crewmember that the pilot seeks to operate under this alternative, and:
> (A) That pilot must have logged at least 1,500 hours of aeronautical experience as a pilot;
> (B) In each airplane that is type certificated for more than one pilot crewmember that the
> pilot seeks to operate under this alternative, that pilot must have accomplished and logged the
> daytime takeoff and landing recent flight experience of paragraph (a) of this section, as the
> sole manipulator of the flight controls;
> (C) Within the preceding 90 days prior to the operation of that airplane that is type
> certificated for more than one pilot crewmember, the pilot must have accomplished and logged at
> least 15 hours of flight time in the type of airplane that the pilot seeks to operate under
> this alternative; and

They diverge at (D):

> **(i)(D)** That pilot has accomplished and logged at least 3 takeoffs and 3 landings to a full
> stop, as the sole manipulator of the flight controls, in a turbine-powered airplane that
> requires more than one pilot crewmember. The pilot must have performed the takeoffs and
> landings during the period beginning 1 hour after sunset and ending 1 hour before sunrise
> within the preceding 6 months prior to the month of the flight.
>
> **(ii)(D)** Within the preceding 12 months prior to the month of the flight, the pilot must
> have completed a training program that is approved under part 142 of this chapter. The approved
> training program must have required and the pilot must have performed, at least 6 takeoffs and
> 6 landings to a full stop as the sole manipulator of the controls in a full flight simulator
> that is representative of a turbine-powered airplane that requires more than one pilot
> crewmember. The full flight simulator's visual system must have been adjusted to represent the
> period beginning 1 hour after sunset and ending 1 hour before sunrise.

Every number in the brief checks out: 1,500 hours; (a) day currency in type; 15 hours in type in
90 days; 3 night full-stops in a multi-crew turbine within 6 months, **or** a part 142 program
with 6 night full-stops in an FFS within 12 months. Three details the brief's summary compressed
and the engine must not:

1. **A commercial certificate with the appropriate category, class, and type rating is a stated
   condition**, not background. It is part of the test.
2. **(i)(B) and (ii)(B) require the (a) day currency "in each airplane" of the type**, as sole
   manipulator — a per-type test, not the general (a) result.
3. **(i)(D)'s aircraft is "a turbine-powered airplane that requires more than one pilot
   crewmember" — not necessarily the type flown.** Note the wording shift from (B)/(C)'s "each
   airplane … that the pilot seeks to operate." The night landings may be in a different
   multi-crew turbine. Do not silently narrow this to same-type.
4. **The window wording in both (D)s is "preceding 6 [12] months prior to the month of the
   flight" — not "6 calendar months."** Ambiguous. A calendar-month reading is *longer* (a 07 AUG
   2026 flight would reach back to 01 FEB 2026) than a rolling-months reading (07 FEB 2026). The
   engine uses the **rolling** reading, because it is the shorter window and ambiguity resolves
   conservatively. Flag it in the output. What would settle it: a Chief Counsel interpretation,
   or an AC addressing 61.57(e)(4)'s windows. **Owner question O-4** (whether to surface the
   difference as a "you may have more margin than shown" note).

Note also that **135.247(a)(3) reproduces this alternative essentially verbatim** for the Part
135 case (verified in the 135.247 fetch above), so a pilot operating under the (e)(3) exemption
reaches the same alternative through a different door. Build one rule, apply it in both branches.

**New fields this needs — none of which exist:**

| Field | Requirement it serves |
|---|---|
| Airman total aeronautical experience as a pilot (hours), or a derived total the pilot confirms | (i)(A)/(ii)(A) — 1,500 hours |
| Airman certificate level + category/class/type ratings held | (i)/(ii) opening condition |
| Aircraft `type_designator` (structured, not free text) on each entry | (B), (C) |
| Aircraft flag: turbine-powered | (D), and (e)(4)'s own trigger |
| Aircraft flag: type certificated for more than one pilot crewmember | (e)(4) trigger, (B), (D) |
| `sole_manipulator` boolean per entry | (B), (D) |
| Per-entry "night landings were inside the 61.57(b)(1) window" assertion | (i)(D) — already implicit in the column semantics; make it explicit |
| Part 142 program completion record: completion date, program approval, device class FFS, device representative of a multi-crew turbine, visual system adjusted to the (b)(1) period, 6 takeoffs and 6 full-stop landings performed as sole manipulator | (ii)(D) — the whole of it. This is a **training-event record**, not a logbook entry; a logbook row cannot carry "the approved program required it." |

The audit's observation that this is the path most of this product's users actually rely on is
consistent with the market: a contract pilot flying a two-crew turbine for a 135 operator very
often has no recent personal night full-stops but does have annual FlightSafety/CAE recurrent in
a Level D device. **Getting (e)(4) wrong in the permissive direction is the highest-consequence
error in this spec** — it is the difference between "you're fine for tonight's leg" and a pilot
launching without night currency.

### 2.7 — 61.56 flight review

Fetched: `https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.56`

> (c) Except as provided in paragraphs (d), (e), and (g) of this section, no person may act as
> pilot in command of an aircraft unless, **since the beginning of the 24th calendar month before
> the month in which that pilot acts as pilot in command**, that person has—
> (1) Accomplished a flight review given in an aircraft for which that pilot is rated by an
> authorized instructor and
> (2) A logbook endorsed from an authorized instructor who gave the review certifying that the
> person has satisfactorily completed the review.

**Recommendation: change the current behaviour — compute it, but only from a date the pilot
entered, and keep declining to derive it from an issue date.** Today `documents` carries a
hand-typed `expires_on` for a `flight_review` row, with no expiry-compute trigger and copy that
says nothing is calculated from anything else. That is the right stance for a *document* (an
issue date does not imply an expiration), but a flight review is different in kind: the reg
states the window explicitly, the arithmetic is unambiguous, and it is the one item on this list
with no interpretive content at all. A pilot typing "31 AUG 2026" into a field is doing the
month arithmetic in their head, which is exactly where the off-by-one lives.

So: add a `flight_review_completed_on` date, derive the through-date with the same calendar-month
expression the operator-qualification trigger uses (§3), and display "valid through 31 AUG 2026,
from a review completed 15 AUG 2024" so the arithmetic is visible.

Two things that keep it hedged: 61.56(d) and (e) list events that **substitute** for a flight
review (a proficiency check or practical test by an examiner, an approved pilot check airman, or
a U.S. Armed Force, for a certificate, rating, or operating privilege; certain flight-instructor
practical tests; an FAA-sponsored pilot proficiency program phase). Many of this product's users
satisfy 61.56 through a 135.293 check rather than a review as such. The engine cannot decide
whether a given check qualified, so:

- The state is computed from `flight_review_completed_on` alone.
- `estimated_not_current` always renders with "a proficiency check or practical test within the
  same period may substitute under 61.56(d) — record its date here if it did," never as a bare
  negative.
- No automatic cross-credit from `operator_qualifications`. Whether a specific 135.293 check was
  "a pilot proficiency check … conducted by an examiner, an approved pilot check airman" within
  61.56(d)(1) depends on who gave it under what authority. **Owner question O-3:** whether to
  offer the pilot a manual "this check satisfied my flight review" checkbox.

### 2.8 — 61.23 medical: not computed, and it should stay that way

Fetched: `https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.23`

61.23(d)'s duration table keys on three axes at once: **class held**, **age on the date of
examination**, and **which operation is being conducted**. The consequence, in the regulation's
own words, is that a certificate "expires, **for that operation**, at the end of the last day of
the …" — the expiry is a property of the (certificate, operation) pair, not of the certificate.

The full table as retrieved, so the argument can be checked rather than taken on trust:

| Class | Age at exam | Operation requiring | Expires end of last day of the |
|---|---|---|---|
| First | Under 40 | ATP certificate for PIC privileges, or SIC privileges in a flag/supplemental part 121 operation requiring three or more pilots | 12th month after the month of exam |
| First | 40 or older | Same as above, or a pilot flightcrew member in part 121 operations who has reached his or her 60th birthday | 6th month after the month of exam |
| First | Any age | Commercial pilot certificate (other than a commercial certificate with a balloon rating when conducting flight training), flight engineer certificate, or air traffic control tower operator certificate | 12th month after the month of exam |
| First | Under 40 | Recreational, private, flight instructor (as PIC or required crewmember, other than glider/balloon), student, or sport pilot certificate (when not using a driver's license) | 60th month after the month of exam |
| First | 40 or older | Same as above | 24th month after the month of exam |
| Second | Any age | ATP SIC privileges (other than the part 121 operations above), commercial, flight engineer, or ATC tower operator certificate | 12th month after the month of exam |
| Second | Under 40 | Recreational/private/CFI/student/sport (as above) | 60th month after the month of exam |
| Second | 40 or older | Same as above | 24th month after the month of exam |
| Third | Under 40 | Recreational/private/CFI/student/sport (as above) | 60th month after the month of exam |
| Third | 40 or older | Same as above | 24th month after the month of exam |

Read the first-class rows together: a single first-class certificate issued to a 45-year-old is
simultaneously valid **6 months** for ATP PIC privileges, **12 months** for commercial
privileges, and **24 months** for private privileges. All three are true at once, of one piece
of paper. A contract pilot flying 135 charter Monday and a friend's Bonanza Saturday is
exercising two of those readings in one week.

**Recommendation: do not compute it, and treat "can it be computed?" as the wrong question.**
It is arithmetically computable — the table above is mechanical. What makes computing it wrong
here is that the output is only meaningful once the engine knows *which privileges are being
exercised on the flight in question*, and the product has no flight-in-question, no certificate
record, and no age-at-exam. A single displayed date would be correct for one reading and
silently wrong for the other two, in the permissive direction for a pilot who read the private
row and flew a charter. The current `documents` design — one pilot-typed `expires_on`, nothing
derived — is at least honest about being one date the pilot chose.

What the engine does instead: shows the medical document's pilot-entered date with the note
"one medical certificate can carry different expiry dates for different privileges under
61.23(d) — the date shown is the one you entered." Building anything more requires the airman
record, counsel review, and privacy review that `docs/PLAN.md` already gates medical data behind.
**Counsel question C-3.**

---

## 3. Calendar-month arithmetic

**Decision: the engine reuses the expression already proven in
`pilot.compute_operator_qualification_expiry()`. No second implementation.** That function
computes a Part 135 check's through-date as:

```sql
base_month  := date_trunc('month', new.completed_on)::date;
new.expires_on := (base_month + ((months_ahead + 1) || ' months')::interval - interval '1 day')::date;
```

Source: `supabase/migrations/20260807110000_operator_qualification_reg_corrections.sql`, STEP 5.

Two forms are needed, and they are the same arithmetic from opposite ends:

**Through-date form** (an event grants validity through the end of month N ahead) — used for
61.56, where `months_ahead = 24`:

```
through = date_trunc('month', completed_on) + interval '25 months' - interval '1 day'
```

**Window-start form** ("within the N calendar months preceding the month of the flight") — used
for 61.57(c), where `N = 6`:

```
window_start = date_trunc('month', flight_date) - interval '6 months'
qualifies    = event_date >= window_start and event_date <= flight_date
```

Note the through-date form uses `N+1` months minus a day and the window form uses plain `N` —
they are not typos of each other. The first counts *forward from the event's month* to the end of
the Nth month after it; the second counts *back from the flight's month* to the first day of the
Nth month before it. Verified against the worked examples below.

**These are not day counts, and the difference is not academic.**

### Worked example 1 — 61.57(c), a date that qualifies and one that does not

Flight date **07 AUG 2026**. `date_trunc('month', '2026-08-07') = 2026-08-01`. Minus 6 months =
**2026-02-01**. So the window is 01 FEB 2026 through 07 AUG 2026 inclusive.

- Six approaches flown **01 FEB 2026** → `2026-02-01 >= 2026-02-01` → **qualifies**, by exactly
  one day of margin.
- Six approaches flown **31 JAN 2026** → `2026-01-31 < 2026-02-01` → **does not qualify.**

A naive 180-day implementation gives `2026-08-07 - 180 days = 2026-02-08` and wrongly excludes
every flight from 01 FEB through 07 FEB — seven days of a pilot's currency, deleted silently, in
the direction that tells a current pilot they are not. A naive `- interval '6 months'` from the
*flight date* gives 2026-02-07 and does the same for six days. Both are wrong for the same
reason: the reg anchors on the **month** of the flight, not the day.

### Worked example 2 — 61.56, a date that qualifies and one that does not

Flight date **07 AUG 2026**. "Since the beginning of the 24th calendar month before the month in
which that pilot acts as PIC": the month of the flight is AUG 2026; the 24th calendar month
before it is **AUG 2024**; the beginning of it is **01 AUG 2024**.

- Flight review completed **01 AUG 2024** → **qualifies**.
- Flight review completed **31 JUL 2024** → **does not qualify.**

Cross-checked with the through-date form, which is what the engine actually stores: a review
completed **15 AUG 2024** gives
`date_trunc('month','2024-08-15') = 2024-08-01`, `+ 25 months = 2026-09-01`, `- 1 day =`
**31 AUG 2026**. So a review done any time in AUG 2024 is good through the last day of AUG 2026 —
including for a flight on 07 AUG 2026, and including one on 31 AUG 2026. Both forms agree, which
is the point of writing them both.

### Rolling-day windows are a different animal

61.57(a) and (b) say "within the preceding **90 days**" — a day count, not calendar months. Do
not reach for `date_trunc` there. The boundary convention is stated in §2.1 and is a conservative
choice, not a derivation.

### Test cases the engine's fixtures must cover

Month-end events (31 JAN, 31 MAR); February in a leap year (2028) and a non-leap year; an event
on the first day of a window; an event one day before it; a flight on the first and last day of a
month; the 135.301(a)-style early/late provision (Part 135 checks only — **it does not apply to
61.56 or 61.57**, and the engine must not borrow it across).

---

## 4. Device classes: FFS, FTD, and ATD get different credit

Three distinct regulatory classes, three different credits. Verified line by line against the
61.57 fetch above.

| Requirement | FFS | FTD | ATD | Conditions from the text |
|---|:--:|:--:|:--:|---|
| **61.57(a)** takeoffs/landings, (a)(3) | ✅ | ✅ | ❌ | Device "(i) Approved by the Administrator for landings; and (ii) Used in accordance with an approved course conducted by a training center certificated under part 142." |
| **61.57(b)** night takeoffs/landings, (b)(2) | ✅ | ❌ | ❌ | FFS "(i) Approved by the Administrator for takeoffs and landings, **if the visual system is adjusted to represent the period described in paragraph (b)(1)**; and (ii) Used in accordance with an approved course conducted by a training center certificated under part 142." |
| **61.57(c)** instrument, (c)(2) | ✅ | ✅ | ✅ | Device "represents the category of aircraft for the instrument rating privileges to be maintained and the pilot performs the tasks and iterations in simulated instrument conditions." **Any combination** of aircraft and devices may be used. **No part 142 requirement here** — unlike (a)(3) and (b)(2). |
| **61.57(d)** IPC, (d)(2) | ✅ | ✅ | ❌ | "(ii) For other than a glider, in a full flight simulator or flight training device that is representative of the aircraft category." |
| **61.57(e)(4)(ii)(D)** night alternative | ✅ | ❌ | ❌ | FFS "representative of a turbine-powered airplane that requires more than one pilot crewmember," visual system adjusted to the (b)(1) period, inside a part 142-approved program that required 6 takeoffs and 6 full-stop landings. |
| **61.56** flight review, (i) | ✅ | ✅ | ❌ | Must be used in a part 142-approved course; the device must represent an aircraft the pilot is rated in; and "[u]nless the flight review is undertaken in a flight simulator that is approved for landings, the applicant must meet the takeoff and landing requirements of § 61.57(a) or § 61.57(b)." |

Two consequences for the schema. First, `simulator_device_type` alone is not enough for any row
in this table above (c): every one of them carries a condition about *the device's approval* or
*the course it was used in*, and none of those facts exist anywhere in the product. Second, the
distinction is not cosmetic — recording a Level D FlightSafety session as `'other'` (the only
option before `20260807120000` added `'ffs'`) made the entire matrix uncomputable, and recording
an ATD session as an FFS would manufacture night currency out of a device that can never provide
it.

Until the approval/course fields exist, **any entry with `simulator_time > 0` that is inside a
61.57(a), (b), (d), (e)(4) or 61.56 window forces `insufficient_data`** for that requirement
rather than being counted or ignored. Counting it asserts approvals the pilot never stated;
ignoring it silently under-credits a pilot whose recurrent training is real. 61.57(c) is the one
exception: (c)(2) accepts all three device classes and imposes no part 142 condition, so a device
row can count there once `approach_condition` exists — the remaining condition ("represents the
category") folds into the category gap that already forces `insufficient_data`.

---

## 5. Part 91 versus Part 135

A contract pilot flies the same airframe under both parts on different days. Which rules bind
changes with the operating part, and the product has never recorded it.

**New input** (owner-approved): `operating_rule` on `pilot.clients` (the default for that client)
and on `pilot.trips` (per-trip override, because one client can be both). Values:
`'part_91' | 'part_135' | 'unspecified'`, defaulting to `'unspecified'` — never to a part.

| Branch | What binds | Engine behaviour |
|---|---|---|
| `part_91` | 61.57 in full; 61.56; 61.23 per privileges exercised | Compute 61.57(a)/(b)/(c) and 61.56 as specified above. |
| `part_135` | 61.57 (unless (e)(3) applies), **plus** 135.243 and 135.247 recency, **plus** the operator's own 135.293/.297/.299 status | Compute 61.57 and 135.247. Surface the pilot's existing `operator_qualifications` rows for that client alongside — as status, never merged into a single verdict, mirroring why that panel is separate today. |
| `unspecified` | Unknown | **`insufficient_data`.** |

**On `unspecified`, the honest answer is not "assume one."** Assuming Part 91 hides the 135.247
and operator-qualification requirements a charter leg is subject to. Assuming Part 135 invents
requirements a Part 91 owner-flight is not subject to and may show a pilot as not-current when
they are fine. Both errors are silent and neither is safe. The engine returns
`insufficient_data` with the specific remedy: "set the operating rule on this client or trip."
This is cheap to fix — it is one field on a screen the pilot already visits — which is exactly
why it is not worth guessing.

A second reason to keep the branch explicit: `operator_qualifications` is per-client and its own
panel copy already draws the line between "the expiry dates you recorded on your own documents"
and "a status on someone else's certificate." Currency output must not blur that line by folding
an operator's check status into a personal-currency verdict.

---

## 6. Output states

Vocabulary is fixed by `docs/PLAN.md`'s "Verified ground truth" and reused verbatim:
`estimated_current`, `estimated_not_current`, `insufficient_data`. No fourth state, no
"expiring soon" state — proximity is a rendering concern, not a status.

**The rule that governs assignment: any missing input that could change the answer produces
`insufficient_data`.** Not a guess, not a default, not a partial credit. A `not_current` that is
really "we couldn't see your other flying" is a false negative a pilot learns to ignore, and an
ignored engine is worse than no engine.

| Currency type | `estimated_current` when | `estimated_not_current` when | `insufficient_data` when |
|---|---|---|---|
| 61.57(a) | ≥3 takeoffs and ≥3 landings in the 90-day window, sole manipulator, matching category/class/type, full-stop if tailwheel | All inputs present, thresholds not met | Sole-manipulator, category/class/type, tailwheel flag, multi-crew-certification flag, or intended aircraft unknown; any unresolvable simulator row in the window. **Today: always.** |
| 61.57(b) | ≥3 takeoffs and ≥3 **full-stop** landings inside the 1-hr-after-sunset/1-hr-before-sunrise window, sole manipulator, matching category/class/type | All inputs present, thresholds not met | As (a); plus any device row in the window without approval/visual-adjustment facts. **Today: always.** |
| 61.57(c) | ≥6 qualifying approaches, ≥1 holding, intercept/track task, all in the 6-calendar-month window | All inputs present, thresholds not met | `approach_condition` missing (today: always); any counted approach with `approach_type` null; category unknown |
| 61.57(d) | *Never emitted* | *Never emitted* | Always — displayed as informational text attached to the (c) result, per §2.4 |
| 61.57(e)(4) | All of (A)–(D) of (i) or (ii) satisfied | All inputs present, not satisfied | Total hours, certificate/ratings, type designator, turbine flag, multi-crew flag, sole manipulator, or part 142 program record missing. **Today: always.** |
| 135.247 | Per §2.5, when `operating_rule = 'part_135'` | Same | `operating_rule = 'unspecified'`; or the (a) input gaps |
| 61.56 | `flight_review_completed_on` present and through-date ≥ today | Present and through-date < today | Date absent |
| 61.23 medical | *Never emitted* | *Never emitted* | Always — the document's pilot-entered date is displayed with the 61.23(d) note, never as a state |

**What the UI shows alongside each state.** Every currency card renders four things, in this
order, with no exceptions and no collapsed variant:

1. **The state**, phrased as an estimate — "Estimated current," "Estimated not current,"
   "Not enough information."
2. **The limiting item and its date** — "3 of 6 approaches since 01 FEB 2026," "earliest
   qualifying landing 12 MAY 2026," "flight review through 31 AUG 2026."
3. **The arithmetic, expanded** — the window's start and end dates, the entries counted, and the
   rule applied. A pilot will hand-check this in week one; being visibly right is the conversion
   event, and being visibly wrong here is caught before it matters.
4. **The reg citation with the section number and the eCFR link**, and the retrieval date of the
   text the rule was built from.

For `insufficient_data` specifically, the card names **which field is missing and where to enter
it**, as a link. "Not enough information" with no remedy trains pilots to ignore the panel, and
the whole engine's value is that its silences are informative.

The disclaimer (§7) renders on the panel itself, above the cards — not in a footnote, matching
the treatment `/reports/year-end` already uses for its own figures.

---

## 7. The disclaimer

Verbatim from `lib/brand.ts`, which marks it COUNSEL-REVIEWED COPY:

> Currency is calculated from the entries you logged and is a planning aid, not a determination
> of regulatory compliance. You remain responsible for your own currency and airworthiness
> decisions.

**Not rewritten here.** Changing it needs the same counsel loop that produced it, so what follows
is a question for counsel, not an edit.

### Question for counsel: "airworthiness"

The audit flagged the final clause. Airworthiness is a property of **the aircraft**, not of a
pilot's recency:

Fetched: `https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=91.7`

> (a) No person may operate a civil aircraft unless it is in an airworthy condition.
> (b) The pilot in command of a civil aircraft is responsible for determining whether that
> aircraft is in condition for safe flight. The pilot in command shall discontinue the flight
> when unairworthy mechanical, electrical, or structural conditions occur.

Fetched: `https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=91.403`

> (a) The owner or operator of an aircraft is primarily responsible for maintaining that aircraft
> in an airworthy condition, including compliance with part 39 of this chapter.

So there is a real sense in which a PIC makes an airworthiness *determination* (91.7(b)) — the
phrase is not nonsense. But it is a determination about the **aircraft**, and this product
computes nothing about any aircraft. A professional pilot reading "your own currency and
airworthiness decisions" on a panel showing landing counts will read it as the software
confusing two different things, and in this market that costs credibility on the sentence that
exists to protect us. It may also, perversely, narrow the disclaimer: naming currency and
airworthiness specifically invites the reading that other determinations were *not* reserved to
the pilot.

**Suggested alternative for counsel to accept or reject** (we have not adopted it):

> Currency is calculated from the entries you logged and is a planning aid, not a determination
> of regulatory compliance. You remain responsible for determining whether you and your aircraft
> are legal for any flight.

The change does two things: it detaches "airworthiness" from the pilot's recency, and it broadens
the reservation from two named items to the whole determination. Counsel may prefer the original
precisely because "currency and airworthiness" tracks 91.7(b) and 61.57 as the two things a PIC
personally determines — in which case we keep it unchanged and this section becomes the record of
why. **Counsel question C-1.**

Whatever counsel decides, `CURRENCY_DISCLAIMER` remains the single source; no screen may
paraphrase it, and any new duty/rest output gets its **own** reviewed string rather than reusing
this one (`docs/PLAN.md`: "you are current" and "you are legal to fly today" are different claims).

---

## 8. What the engine will not do

Generously scoped on purpose. Each line is a place where the honest answer is "we cannot see the
inputs," and shipping any of them would trade the product's credibility for a number.

- **14 CFR 135.267 duty, rest, and flight-time limits.** Fetched:
  `https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=135.267`. The text
  is explicit that the counting is cross-employer: "(a) … if that crewmember's **total flight
  time in all commercial flying** will exceed—(1) 500 hours in any calendar quarter. (2) 800
  hours in any two consecutive calendar quarters. (3) 1,400 hours in any calendar year," and
  "(b) … the total flight time of the assigned flight **when added to any other commercial
  flying** by that flight crewmember may not exceed—(1) 8 hours for a flight crew consisting of
  one pilot; or (2) 10 hours for a flight crew consisting of two pilots …". A product that sees
  the flying a pilot chose to record in *this* product cannot see all commercial flying, and a
  tool that says "within limits" when flying for an operator the pilot never entered has already
  pushed them over is worse than saying nothing. `docs/PLAN.md` reaches this conclusion already;
  this spec does not reopen it. If it is ever built it ships inside this flag with its own
  reviewed disclaimer, and it degrades honestly ("missing data after 12 JUL — verdict
  incomplete") rather than completing.
- **Whether a specific flight may legally be conducted.** Currency is one input among aircraft
  airworthiness, weather, fuel, duty, medical, operator authorisation, and insurance. The engine
  sees one.
- **61.23 medical duration** — §2.8.
- **61.58 compliance determination.** Fetched
  `https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.58` (paraphrased
  below — the fetch tool used could not return long exact quotes; cross-checked across two
  independent fetches of the same URL that agreed on every point, but re-fetch directly before
  citing it verbatim). 61.58(a) binds a PIC of an aircraft type certificated for more than one
  required pilot flight crewmember, or of a turbojet airplane, to TWO distinct periods — a check
  within the preceding 12 calendar months in any qualifying aircraft, and within the preceding 24
  calendar months in the specific type. 61.58(b) exempts a pilot operating under 14 CFR part 91
  subpart K, or parts 121, 125, 133, 135, or 137, entirely — which means most of this product's
  users are outside 61.58 for their Part 135 flying specifically (the operator's own training/
  check program governs instead, the same posture 61.57(e)(3)/135.247 already take in §2.5) and
  inside it mainly for non-135 flying (owner flights, repositioning legs not under a certificate)
  in a qualifying aircraft — this narrows, but does not eliminate, the audit's framing that 61.58
  reaches "essentially every aircraft this product's users fly." **`pilot.documents` now records
  it** (`supabase/migrations/20260807140000_approach_conditions.sql` adds the
  `pic_proficiency_check` kind) — a pilot-typed completion/expiry date, the same shape as
  `flight_review`, with no computed expiry and no cross-credit asserted from
  `operator_qualifications`. What remains undone, and stays undone deliberately: no 12-month/
  24-month expiry is derived from the date entered, and no code anywhere decides whether a
  specific check satisfied 61.58 or whether a Part 135 check exempted the pilot under (b) for a
  given flight — that determination needs the operating-rule fact per flight this spec's §5
  already declines to guess, plus the same "was this check conducted in a way that satisfies a
  different reg" question §2.4/§2.7 already leave to the pilot for 61.56/61.57(d).
- **61.31 type-rating and endorsement requirements**, **61.55** SIC qualification,
  **61.51** logging sufficiency. The product stores the logbook; it does not audit it.
- **Whether a 135.293/.297/.299 check satisfies 61.56 or 61.57(d)** — §2.4, §2.7.
- **Whether 61.57(e)(3)'s "employed by" reaches a 1099 contract pilot** — §2.5, counsel question.
- **Insurance minimums and operator policy limits.** Frequently stricter than the reg, entirely
  invisible to us, and a pilot who is reg-current and insurance-short is the exact failure this
  panel must not cause. Worth a future "operator policy overlay" the pilot enters themselves;
  not in Phase 7.
- **Anything derived from an issue date.** The `documents` stance holds: an issue date does not
  imply an expiration. 61.56's through-date is derived from a **completion** date the pilot
  entered for that purpose, which is a different thing.
- **Night-window determination from coordinates and time.** The engine will not compute sunset,
  sunrise, or civil twilight for an airport and date to decide whether a landing was inside
  61.57(b)(1)'s window. The pilot asserts it per entry. Computing it would require airport
  coordinates, exact landing times (the logbook records neither), and the Air Almanac for the 1.1
  case — and getting it wrong lands precisely on the most dangerous error in §2.2.

---

## 9. Required schema changes

Every column the engine needs that does not exist today, tied to the requirement that needs it.
Nothing in this list is written by this document — Phase 7's own migration writes them, after
this spec is signed off.

**On a new airman record** (`pilot.airmen`, or equivalent, keyed to `account_members.user_id`):

| Field | Needed by |
|---|---|
| `certificate_level` (ATP / Commercial / Private / …) | 61.57(e)(4) opening condition |
| `ratings[]` — category, class, type designator, PIC/SIC privilege | 61.57(a)(1)(ii), (b)(1)(ii), (c)(1), (e)(4); 135.247(a) |
| `total_aeronautical_hours` (pilot-confirmed, not silently derived) | 61.57(e)(4)(i)(A) / (ii)(A) — 1,500 hours |
| `flight_review_completed_on` | 61.56(c) |

**On `pilot.logbook_entries`:**

| Column | Needed by |
|---|---|
| `sole_manipulator boolean not null default false` | 61.57(a)(1)(i), (b)(1)(i), (e)(4)(B)(D); 135.247(a). `role` is not a substitute. |
| ~~`approach_condition text check (… in ('actual','simulated','neither'))` per entry~~ **Shipped** by `supabase/migrations/20260807140000_approach_conditions.sql` — nullable, NULL means unknown, every pre-existing row reads that way (never coerced to a qualifying or disqualifying value), and a CHECK forbids pairing `approach_type = 'visual'` with `'actual'`/`'simulated'` so the two axes can't contradict each other in the row itself. | 61.57(c)(1) — "in actual weather conditions, or under simulated conditions using a view-limiting device." **Was the live blocker on 61.57(c); the input gap is now closed. §2.3's `insufficient_data` still applies when this is NULL or category is unknown — an engine is not built by this migration.** |
| `aircraft_category`, `aircraft_class`, `type_designator` (structured) | 61.57(a)(1)(ii), (b)(1)(ii), (c)(1)/(c)(2), (e)(4)(B)(C); 135.247(a) |
| `simulator_device_approved_for_landings boolean` | 61.57(a)(3)(i), (b)(2)(i); 61.56(i)(2) |
| `simulator_part_142_course boolean` | 61.57(a)(3)(ii), (b)(2)(ii), (e)(4)(ii)(D); 61.56(i)(1) |
| `simulator_visual_adjusted_night boolean` | 61.57(b)(2)(i), (e)(4)(ii)(D) |
| `night_window_asserted boolean` (the (b)(1) window, distinct from 1.1 night) | 61.57(b)(1) — makes explicit what the column comments currently carry implicitly |

**On aircraft** (no aircraft record exists; either a `pilot.aircraft` table keyed on tail number,
or these as per-entry fields):

| Field | Needed by |
|---|---|
| `is_tailwheel boolean` | 61.57(a)(1)(ii) full-stop rule |
| `is_turbine boolean` | 61.57(e)(4) trigger; (i)(D) |
| `certificated_more_than_one_pilot boolean` | 61.57(a)(1) trigger on empty legs; (e)(4) throughout |
| `type_designator` | 61.57(e)(4)(B)(C); 135.247 |

**On `pilot.clients` and `pilot.trips`** (owner-approved):

| Field | Needed by |
|---|---|
| `operating_rule ('part_91'\|'part_135'\|'unspecified')` on both, default `'unspecified'` | §5 branch; 135.247; 61.57(e)(3) |
| `part_135_employer_exemption_asserted boolean` on the client | 61.57(e)(3) — pilot's assertion, never inferred (§2.5) |

**A training-event record** (new table; a logbook row cannot carry it):

| Field | Needed by |
|---|---|
| Part 142 program completion date, device class, "representative of a multi-crew turbine," visual system adjusted to the (b)(1) period, takeoffs and full-stop landings performed as sole manipulator, and that the **program required** them | 61.57(e)(4)(ii)(D) in full |

**Not on this list, deliberately:** anything medical beyond what `documents` already holds. That
needs counsel and privacy review first (`docs/PLAN.md`, standing gates).

---

## 10. Open questions

### For the owner (product decisions)

- **O-1. Does the flag ship at all before the airman record exists?** As specified, every 61.57
  state resolves to `insufficient_data` today. That is honest and it is also a panel of eight
  cards all saying "not enough information," which reads as broken software rather than as
  careful software. Options: (a) hold the flag until the airman record and the fields in §9 ship;
  (b) enable it showing only 61.56, which is fully computable today, plus an explicit "currency
  needs these fields" state for the rest. Recommendation: **(b)**, because it gets the arithmetic
  in front of pilots on the one item where we can be visibly right, and because a card that names
  the missing field is a working feature request queue.
- **O-2. Priority order for §9's fields.** Cheapest-to-highest-value: `approach_condition` (one
  column, unblocks 61.57(c)); `sole_manipulator` (one column, on the critical path for
  everything); structured category/class/type (needs the airman record to be useful).
- **O-3. Manual "this check satisfied my flight review" checkbox?** §2.7. It lets a pilot who
  satisfies 61.56 via 61.56(d) record it, at the cost of a field where a pilot can assert
  something we cannot check.
- **O-4. Surface the (e)(4) window ambiguity to the pilot,** or apply the conservative reading
  silently? §2.6, point 4. Surfacing it is more honest and more confusing.
- **O-5. Does 61.57(e)(4) get built in Phase 7 or after?** It is specified here per your request.
  It also needs the most new fields of anything in §9, and the audit says it is the path most of
  our users rely on — meaning the feature is least useful to our actual market until it exists.
- **O-6. Does a `role = 'SOLO'` entry count toward 61.57(a)/(b) recency?** `supabase/migrations/
  20260809000000_logbook_role_vocabulary.sql` added `SOLO` (61.51(d), sole occupant) to the role
  vocabulary. A student pilot's solo time is logged as PIC time under 61.51(e)(4), which reads as
  "yes, treat it like PIC for (a)/(b) purposes too" — but that reasoning was not verified against
  the eCFR text closely enough by this pass to state as settled, and this product's actual market
  (contract pilots on type-rated recurrent training, not student pilots building solo time) makes
  it a low-frequency case that is easy to get wrong quietly. §2.1's computation pseudocode
  currently does NOT exclude `SOLO` from the 61.57(a)/(b) window (unlike `DUAL_RECEIVED`, which the
  same change excludes with higher confidence — see §2.1's inputs table). Confirm before Phase 7's
  engine ships whether that inclusion is correct, or whether `SOLO` needs the same exclusion
  `DUAL_RECEIVED` gets.

### For counsel (legal-exposure decisions)

- **C-1. The word "airworthiness" in `CURRENCY_DISCLAIMER`.** §7. Category error, or a deliberate
  tracking of 91.7(b)? Suggested alternative provided; do not change the string without your
  sign-off either way.
- **C-2. Does 61.57(e)(3)'s "employed by a part 119 certificate holder" reach a 1099 contract
  pilot** flying on that operator's certificate under its training program? Our entire user base
  is on the wrong side of the ordinary meaning of "employed." The engine as specified never
  infers the exemption, but the UI must describe the assertion in wording that does not imply the
  product has assessed it. We need your language for that field's label and help text.
- **C-3. Medical.** §2.8 recommends continuing not to compute 61.23. Confirm, and confirm the
  copy that accompanies the pilot-entered date.
- **C-4. Does displaying a computed 61.56 through-date cross from "planning aid" into
  "determination"?** §2.7 recommends computing it because the arithmetic is unambiguous. It is
  also the first place this product would state a compliance-relevant date the pilot did not
  type. If that is the line, say so and we will display the completion date only.
- **C-5. Disclaimer placement and persistence.** It renders above the cards and is stored NOT
  NULL on every snapshot. Is a per-card repetition needed, or is panel-level sufficient?
- **C-6. Any duty/rest output** (§8) requires its own reviewed disclaimer distinct from this one,
  per `docs/PLAN.md`. Nothing here proposes building it; flagged so the gate is not lost.

---

## 11. Defects and stale documentation found while writing this

Noted here rather than fixed, per this document's own scope.

1. **`docs/PLAN.md`'s aviation-review section is stale in two places.** It says "No day-takeoff
   count is recorded at all — only landings" and "No record of intercepting and tracking a
   course." Both were closed by `20260807120000_logbook_reg_corrections.sql` (sections C and D).
   The section's own instruction — "Keep this list current as the gaps close" — has not been
   followed. The *conclusion* (61.57 is not computable, Phase 7 is blocked) still holds, for the
   different reasons in §6 of this document.
2. **The brief for this spec described a 6-month/12-month structure in 61.57(d) that is not in
   the current text.** §2.4. Whoever holds the source for that reading should produce it or drop
   it.
3. **`approaches_count` and `approach_type` are one-to-one per entry**, so an entry with three
   approaches of two different types cannot record which were which. For 61.57(c) that matters
   only for excluding visual approaches; a pilot who flew two ILS and one visual on one entry
   must either split the entry or over-count. Worth a per-approach child row eventually; the
   engine should meanwhile treat a mixed entry conservatively by counting **zero** qualifying
   approaches when `approach_type = 'visual'` and `approaches_count > 1`.
4. **`pilot.documents` has no expiry-compute trigger**, so the `flight_review` row's `expires_on`
   is whatever the pilot typed — including a date that is arithmetically impossible under
   61.56(c). §2.7 proposes deriving it from a completion date instead; until then the engine
   cannot distinguish a correct date from a typo.

---

## 12. Addendum — 2026-08-10: implementation review

The engine described above was implemented on 2026-08-10 on branch `claude/launch-ready`. This
section records what re-verification found. **§§1–11 above are unchanged and remain the reviewed
document**; nothing here is edited into them, because a spec whose body is silently rewritten is
not reviewable. Read this section alongside them.

### 12.1 Regulatory drift: none

Every section quoted above was re-fetched from the eCFR versioner API at **both** issue date
`2026-08-05` (the date §§1–11 were written against) and `2026-08-06` (the API's current ceiling for
title 14), and the two were byte-compared: **61.57, 61.56, 61.23, 61.51, 61.58, 1.1, 135.247,
135.267, 135.301, 91.7 and 91.403 are byte-identical between the two dates.** No arithmetic above
needs re-deriving because the text moved. Title 14's `latest_issue_date` is 2026-08-05 and it is
`up_to_date_as_of` 2026-08-06; **requesting a later date returns HTTP 404**, which is worth knowing
before someone reads a 404 as "the section was withdrawn".

§2.4's headline finding was re-confirmed directly: the current text of **61.57(d) contains no
12-month element.** Do not build to the structure the original brief described.

### 12.2 Corrections owed to the body

Three defects in §§1–11, none of which change a computed answer, all of which matter because this
document's authority rests on the claim that it quotes exactly:

1. **§2.4 truncates 61.57(d)(1) mid-paragraph with no ellipsis.** The text continues: *"The
   instrument proficiency check must include the areas of operation contained in the applicable
   Airman Certification Standards (incorporated by reference, see § 61.14) as listed in appendix A
   of this part as appropriate to the rating held."*
2. **§2.4's quotation of 61.57(d)(3)(iii) drops a clause silently.** The marked ellipsis covers the
   subpart K insertion, but the trailing *"or fractional ownership program manager, as applicable"*
   is dropped unmarked.
3. **§11 defect 3's mitigation is stated backwards.** It directs the engine to count zero qualifying
   approaches when `approach_type = 'visual'` and `approaches_count > 1` — but a visual row is
   already excluded wholesale by §2.3's own filter and by `20260807140000`'s CHECK, so that branch
   can never fire. The real, undetectable hazard is the mirror image: an entry tagged `ils` with
   `approaches_count = 3` where one of the three was flown visually. The implementation counts them
   and discloses the assumption in the expanded arithmetic; a per-approach child table is the
   eventual fix.

### 12.3 The highest-severity finding: 135.247(b)

**§2.5's Part 135 branch, built exactly as written, would tell a tailwheel pilot they are
night-current on touch-and-goes.** 135.247(b)'s tailwheel full-stop rule is absent from §2.5. The
implementation carries it; the spec does not. This is the one item in this addendum that would have
produced a wrong answer about whether a pilot may carry passengers at night.

Also missing from §2.5: 61.57(e)(3) disapplies **all** of 61.57 for a qualifying Part 135 pilot, and
the text conditions that on compliance with **both** 135.243 and 135.247 — not 135.247 alone.

### 12.4 Where the spec is stale against the repo

Five migrations landed on 2026-08-10 that §§1–11 never saw. The load-bearing ones:

- **§1's "no aircraft record exists at all" is now false.** `pilot.aircraft` exists with `gear`,
  which closes the `is_tailwheel` input 61.57(a)(1)(ii) needs. Critically, the correct grouping unit
  is **`type_rating`, not `type_designator`** — one CE-500 rating covers five ICAO designators, so
  matching on the designator would tell a CE-500 pilot their Citation Bravo landings do not count
  toward their Citation V, and they do. There is deliberately **no** `aircraft_id` foreign key on
  `logbook_entries`, because that table is a 61.51 legal record; the registry annotates at read time
  by normalised tail key, and the engine reuses the existing `tailKey()` rather than writing a third
  implementation of a normalisation that has already disagreed once.
- **§1's "there is no airman record" is half true, and the half that changed is safety-critical.**
  `logbook_entries.airman_user_id` exists. §2.1's pseudocode keys only on `account_id`, which in a
  multi-seat business account **sums two pilots' landings into one verdict that is true of neither,
  in the permissive direction.** Every query and every snapshot must key on
  `(account_id, airman_user_id)`, and an entry in the window with a null airman must force
  `insufficient_data` rather than be attributed by guess.
- **§2.7 and §6 treat 61.56 as computable today and O-1(b) recommends enabling the flag on that
  basis. It is not computable.** `pilot.documents` records `expires_on` but no completion date of
  any kind, and 61.56 arithmetic runs from the completion. This is one nullable column, but it is
  not zero, and **O-1(b) should not be read as ready until it ships.**
- **§2.5 and §5's `operating_rule` vocabulary does not match what shipped.** `trips.operating_rule`
  is NOT NULL with a two-value CHECK, so §5's `unspecified` branch is unreachable at trip level;
  and `clients.operating_rule` carries a fourth value, `both`, that §§1–11 never mention — which is
  exactly the fact pattern 61.57(e)(3) describes.
- **§9 proposes `sole_manipulator boolean not null default false`. Do not build that.** A NOT NULL
  default backfills every existing row with an assertion the pilot never made, collapsing
  "unrecorded" into "asserted not sole manipulator" — the two states the engine most needs to tell
  apart, since one yields `insufficient_data` and the other yields `estimated_not_current`. Ship it
  nullable, for the same reason `20260807140000` gave for `approach_condition`.
- **§9's account-level hour rollups must not feed 61.57(e)(4)(A)'s 1,500-hour test.** Those are the
  hours a pilot entered into this product, which is not aeronautical experience — a twenty-year
  captain's first entry here is not hour one.

### 12.5 One deliberate departure from §6, for review

§6 lists a multi-crew-certification flag among the gates that force `insufficient_data` for
61.57(a). That flag answers whether (a) **binds** on an empty leg — a question about scope, not
about the count — so leaving it as a computation gate makes 61.57(a) return "not enough
information" permanently, even after every other field in §9 ships. That is precisely the panel of
cards-saying-nothing that O-1 warns against. The implementation handles it in copy instead and takes
it off the gate list. **Flagged here rather than done silently, because it is a change to a reviewed
decision.**

### 12.6 Scope exclusions that were silent and should be explicit

§8 is the list of deliberate refusals, and silence there is indistinguishable from oversight. Three
paragraphs carry currency arithmetic this engine does not implement: **61.57(c)(3)** (the glider
instrument track, with its own six-calendar-month window), and **61.57(f) and (g)** (NVG, on two-
and four-calendar-month windows). All three are correctly out of scope for this market. They should
be named in §8 rather than absent from it.

### 12.7 Status

The flag is `CURRENCY_ENGINE_ENABLED` and it is **off**: it requires the exact string `true`, so an
unset variable, an empty variable, and the string `false` all read as off. Nothing renders currency
to a pilot today. **The gates in `docs/LAUNCH-GATES.md` are unchanged — counsel reviews the
disclaimer, Tony reviews this document, and only then does the flag move.**

### 12.8 Addendum — the sixth round, and one behaviour change worth your eyes

The two remaining findings from the fifth review are closed, and this section records the one that
changes an answer rather than a word.

**Two discriminators became one.** The engine asked "does this row have any real aircraft time?" in
two places with two different proxies. `instrument.ts` keyed on `approachCondition` — actual weather
cannot happen in a box, so a row logged `actual` must be real. Sound reasoning, but a proxy, and it
was wrong in exactly one shape: a MIXED row (real aircraft time left over after subtracting simulator
time) whose approaches were flown under a view-limiting device **in the aircraft** per 61.57(c)(1),
not in the device session the same entry also logs. `passenger-shared.ts` read that row correctly as
real-aircraft; `instrument.ts` read the identical row as a device session and could never make it
certain. `lib/currency/simulator.ts` is now the single predicate both import, on this schema's own
definition of wholly-simulator (`total_time <= simulator_time`, the condition
`20260810020000`'s CHECK already uses to permit a null crew role).

A reviewer constructed the disagreeing row and ran it: the old `instrument.ts` test called it a
device session, the old `passenger-shared.ts` test called it real, and all five cards now agree it is
real and credit it.

**THE BEHAVIOUR CHANGE.** A consequence of using one predicate in both modules is that a mixed row
logged `simulated` can now become **certain, credited instrument evidence**, where before it was
permanently ambiguous. That is correct — the row genuinely has real aircraft time and the approaches
were genuinely flown in the aircraft — but it credits approaches the previous code never could, so it
is a change to a currency verdict and not merely to a disclosure. It is flagged here rather than
buried in a diff.

**And the assumption behind it is now stated.** Where a mixed row is counted, the card says its
movements were taken as flown in the aircraft. The schema records no split of movements between the
aircraft and the device, so that attribution is an assumption — the only one available, and
defensible, but this engine's posture is that its assumptions are visible.

**Still not verified:** the database-contract half of `currency:verify` did not run in that session,
and the new mixed-row instrument case was not added to the property-test invariant table. Neither
blocks anything while the flag is off, and both belong to whoever picks this up.

### 12.9 Addendum — the "latest snapshot" view returned the wrong snapshot

Found by an automated reviewer on PR #26 after that PR had already merged, and confirmed by an
independent adversarial pass that overturned a first investigation's "not a defect" verdict.

**What was wrong.** `pilot.currency_snapshots_latest` selected `distinct on (account_id,
airman_user_id, currency_type)` ordered by `as_of desc, computed_at desc, id desc`. `DISTINCT ON`
keeps the first row per group, so the *evaluation date* decided which snapshot a reader got and
the *computation time* only broke ties within one evaluation date. Once two rows existed whose
`as_of` order disagreed with their `computed_at` order, the earlier computation won permanently
and no later recomputation could ever be seen.

**Why that is a currency defect and not a tidiness one.** The shadowed row is not a redundant
recompute of the same facts — it is computed from *corrected* facts, and every correction this
product supports that changes an answer removes credit rather than adding it: a landing count
fixed downward, an aircraft's gear recorded (after which a tricycle-gear landing stops counting
toward 61.57(a)(1)(ii)), a role corrected to `DUAL_RECEIVED` (which §2 requires never count toward
61.57(a) or (b)), or a truncated read that becomes `insufficient_data`. So the newer computation is
the stricter one, the shadowing row says `estimated_current`, and the card shows a pilot a verdict
the engine has since revised downward. Permissive staleness is the one direction this engine may
never fail in.

**It needed no future-dated write.** The first investigation discounted the finding on the grounds
that nothing in the product writes a planned-trip snapshot with a future `as_of`, which is true.
The adversarial pass established that the premise is not load-bearing: `lib/currency/read.ts`
already documents that an `as_of` taken in the pilot's local timezone runs a day behind a
server-side UTC date for any client west of Greenwich after 17:00 local. Two recomputes either side
of local midnight reproduce it. This is the second time in this engine's history that a defect was
dismissed because the named trigger did not exist while the *shape* did — see §12.8 and the six
rounds before it.

**The fix.** `20260811050000_currency_snapshots_latest_by_computation.sql` reorders to
`computed_at desc, as_of desc, id desc` and rebuilds the supporting index to match. It is a new
migration rather than an edit to `20260811040000` for two reasons: whether that file has been
applied is not determinable from this repository (see `supabase/migrations/README.md` on recorded
versions), and its index is created with `create index if not exists`, which matches on **name and
not definition** — re-running an edited copy against a database that already holds the index would
silently skip it and leave a live index disagreeing with the view, with no error. The new file
drops the index by name and recreates it.

**What the view now commits to,** stated so the next edit does not have to infer it: the most
recently *computed* assessment of the pilot's *current* state. That is what §12.8's file already
claimed in prose — its own comments frame the view in recomputation terms and never mention
`as_of` — so the ORDER BY was the only part implementing a different meaning.

**A constraint on future work.** If planned-trip or what-if evaluation is ever built, it must not
share this table without a discriminator column. No single ordering over a mixed table answers
both "what is my currency now" and "what would it be on the 20th", and this view answers only the
first.

**Verified this session:** `currency:verify` now runs 605 checks, of which S-18 is this regression,
asserted against a real Postgres with both halves running. S-18 was proved to bite by restoring the
old ordering and watching it fail, then restoring the fix and watching it pass. The engine remains
dark: `CURRENCY_ENGINE_ENABLED` is off and no screen imports `read.ts`.
