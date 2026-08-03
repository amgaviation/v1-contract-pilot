# V1 — Design System Brief

**You are designing a visual identity and design system from scratch.** This
document tells you what the product is, who uses it, and what has to fit on
the screen. It deliberately does not tell you what it should look like — no
palette, no type, no layout treatment is specified or implied. Those are
yours to decide.

---

## The product

**V1** is a web application that lets an independent contract pilot run their
own business: their clients, their trips, their invoices, their expenses,
their flight logbook, and their regulatory currency.

It is single-operator software. The customer is one working pilot (sometimes
a small flight department of two to five), not an airline, not a broker, not a
fleet operator. They are the business owner, the salesperson, the bookkeeper,
and the pilot, and this is the tool that holds all four jobs.

**The organizing idea:** one trip a pilot flies generates three separate
records — a logbook entry, a billable line on an invoice, and a set of
expenses. Every tool on the market today makes them enter that same trip three
times, in three places. V1's entire premise is *log the trip once, and the
logbook entry, the invoice line, and the expense file all come from it.*

The design should make that single-source relationship feel obvious. A trip is
the parent object; nearly everything else in the product hangs off it.

---

## Who uses it

A professional pilot flying under contract — hired per trip by aircraft owners
or operators, usually on business jets and turboprops.

What matters about them, for design purposes:

- **They are domain experts and read dense technical information all day.**
  Their working environment is already full of precise, high-density, purely
  functional displays. They are not intimidated by a screen with a lot of
  numbers on it, and they are actively suspicious of software that looks like
  it is trying to impress them. Restraint and precision read as competence
  here; decoration reads as a vendor who doesn't understand the work.
- **They are time-pressured and often mid-travel.** Sessions happen between
  legs, in an FBO lounge, in a hotel at 22:00 after a duty day, on a tablet.
  Tasks need to be completable in short bursts and survive interruption.
- **They are running a business they'd rather not be running.** Nobody became
  a pilot to chase invoices. Administrative friction is the enemy; the product
  wins by making the paperwork nearly disappear.
- **Their money is lumpy and self-managed.** They invoice per trip, wait to
  get paid, and track deductible expenses themselves for tax. Financial
  clarity is a core emotional need, not a reporting feature.

Assume desktop and tablet both matter. Tablet especially — this user
population lives on iPads professionally. Phone is secondary but shouldn't
break.

---

## The industry, briefly

Business and general aviation. A contract pilot is a freelancer with an
FAA certificate who gets called to fly someone else's aircraft — an owner's
jet, a repositioning flight, a maintenance ferry.

Three industry facts that shape the product:

1. **Pilots must stay "current" to legally carry passengers.** Federal
   regulation requires a specific number of takeoffs and landings within
   rolling time windows, some of them at night and to a full stop, plus
   instrument approaches, plus an unexpired medical certificate and a recent
   flight review. Falling out of currency grounds them. The product tracks
   this and shows it — which means **status display is a first-class design
   problem here, not a decorative badge.**

2. **The logbook is a legal record.** It can be produced in an FAA enforcement
   action, an insurance claim, or a job interview. It is the single most
   consequential data in the product, and the interface around it should feel
   like it knows that. Nothing should ever be written to a logbook without the
   pilot explicitly confirming it.

3. **The invoice is a document the pilot's own client sees.** It leaves our
   product as a PDF and lands in the inbox of an aircraft owner or a flight
   department manager. It carries the pilot's professional reputation, not
   ours. It must look like a serious business document, and it must survive
   being printed.

---

## Brand

The product name is **V1**.

V1 is the aviation callout for takeoff decision speed — the moment on the
takeoff roll past which the pilot is committed to fly. Every pilot knows it
instantly. It is not a version number, and nothing in the design should let it
read as one.

Descriptor line, where a descriptor is needed: **Contract Pilot**.

There is one and only one external attribution: the phrase
*"powered by AMG Aviation"*, which may appear in the application footer and on
the marketing about page. It must never appear in the primary navigation, in
the page header, on a generated invoice, or in transactional email. The
invoice in particular belongs entirely to the pilot.

You are free to design a wordmark. The name is short and the meaning is
specific — a symbol or icon is optional and probably unnecessary.

---

## Information architecture

Seven top-level destinations. This list is fixed:

| Section | What it holds |
|---|---|
| **Overview** | The landing screen. Financial summary, regulatory currency, and everything needing action. Detailed below. |
| **Trips** | The parent record. Each trip has a client, date range, aircraft, day rate, day count, and a set of individual flight legs. |
| **Invoices** | Drafted from trips. Line items, sequential numbering, PDF generation, payment status, and delivery either by email from the app or manual download. |
| **Expenses** | Receipt capture, assignment to a trip, and a decision per expense: rebill it to the client, deduct it at tax time, or neither yet. |
| **Logbook** | Flight records. Entered manually, derived from a trip, or bulk-imported from another logbook product. Times, landings, approaches, aircraft. |
| **Clients** | The pilot's own customers. Contacts, billing address, default day rate, payment terms, and tax-form status. |
| **Documents** | Certificates, medical, passport, insurance, tax forms. Each with an expiry date that feeds the currency display. |

Navigation is persistent — the user moves between these constantly and should
never lose their place in the hierarchy. Detail views live inside a section
rather than replacing the whole screen.

---

## The Overview screen — full content inventory

This is the most information-dense screen and the one to design first. It has
four distinct regions.

**1. Four financial figures, shown together:**
- Unbilled Work (money earned, not yet invoiced)
- Awaiting Payment (invoiced, not yet paid)
- Paid This Year
- Deductible Expenses

These are currency values. They are the first thing the user looks at.

**2. Currency & Expirations — six rows, each with a status:**
- Day passenger currency
- Night passenger currency
- Instrument currency
- Medical certificate
- Flight review
- Passport

Each row needs to communicate: what it is, whether the pilot is currently
legal, and when it lapses. Some rows also carry the threshold the status was
judged against — e.g. *3 landings required, 1 logged*.

Three status levels only: **good / needs attention / not current.** Do not
design a four- or five-level severity scale; the underlying data has three
states and inventing more will produce meaningless distinctions.

This region must carry a visible plain-language disclaimer stating that the
calculation is a planning aid and not a determination of regulatory
compliance, and that the pilot remains responsible for their own currency
decisions. This is a legal requirement, not a footnote to be styled away —
design it as a real, readable part of the region.

**3. Ready to Invoice — a list of completed trips awaiting billing.** Each
entry carries a route (two or more airport codes), an aircraft tail number, a
number of days, a date range, and an amount that splits into a day-rate
portion plus a rebillable-expenses portion.

**4. Needs Attention — a mixed action queue.** Three kinds of item share this
list: invoices past due, receipts not yet assigned to a trip or marked
deductible, and clients whose tax paperwork is outstanding. Each needs a clear
label, enough context to act, and an action.

---

## Data characteristics the system has to handle

These recur across every screen. The design system needs a considered answer
for each.

- **Currency amounts**, frequently compared down a column, sometimes negative.
- **Flight times**, in decimal hours (`1.4`, `12.7`), also compared in columns.
- **Dates and date ranges**, often abbreviated, occasionally in UTC with a
  `Z` suffix.
- **Aircraft tail numbers** (`N412C`, `N88GT`) — mixed letters and digits,
  identity-critical, must never be truncated in a way that loses the end.
- **Airport codes and routes** (`KTEB → KPBI`) — four-letter codes, often
  chained into a multi-leg sequence.
- **Status values**, on nearly every record type: an invoice is draft / sent /
  paid / overdue; an expense is rebillable / deductible / unassigned; a
  document is valid / expiring / expired.
- **Long tabular lists.** A pilot reviewing a quarter of work needs to scan
  many rows at once. Roughly 20–30 rows visible on a standard laptop screen
  without scrolling is the working target. **Density is a product requirement,
  not an unfinished state** — a spacious, generously-padded interface would
  actively fail this user.
- **Totals**, which need to be visually distinct from the rows that produce
  them.
- **Empty states**, which will be common early — a new user has no trips, no
  clients, no invoices.

---

## What to deliver

A complete design system, plus its application to real screens.

**The system:**
- A colour palette with defined semantic roles, including a three-level status
  scale that is distinguishable by more than hue alone.
- A type scale with assigned roles. Note that this product mixes running text,
  small dense labels, and columns of figures that must align — the last of
  those has specific requirements you'll want to solve deliberately.
- A spacing scale.
- Light and dark themes. Both are expected; neither is an afterthought.
- Component specifications for at minimum: persistent navigation, a grouped
  content container, a data table (including a totals treatment), status
  indicators, buttons in at least two levels of emphasis, form inputs, the
  financial-figure display, and empty states.

**Applied to four screens:**
1. Overview (the full inventory above)
2. Trips — list view and a single trip's detail view
3. Invoice — both the in-app editor and the outgoing PDF, which is a
   different design problem with a different audience
4. Logbook — a dense, table-heavy record view

**Practical constraints:** it will be built in React with CSS custom
properties, so express the system as tokens. Every visual value needs to live
in the token layer — this is enforced in the codebase, and a design that
depends on one-off values won't survive implementation.

---

## What this product is not

Guardrails, because each of these would pull the design in a wrong direction:

- **Not a consumer finance app.** The user is a business operator looking at
  their own revenue, not a consumer being encouraged to budget.
- **Not a marketplace or job board.** No pilots browsing work, no ratings, no
  profiles, no social layer. The pilot's clients are their own.
- **Not an airline or fleet operations system.** No dispatch, no crew
  scheduling, no aircraft management.
- **Not an analytics dashboard.** There is very little here that wants to be a
  chart. This is a record-keeping and billing product; the tabular data *is*
  the interface. Reach for a chart only where one genuinely answers a question
  a table can't.
- **Not a flight planning or navigation tool.** No maps, no weather, no
  charts. It never touches the operational side of flying.
