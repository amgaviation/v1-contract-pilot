# V1 user guide

V1 is the books for an independent contract pilot. Log a trip once, and the
invoice lines, the logbook draft, and the receipts you attach to it all come
off that one record, instead of being typed a second and third time into a
spreadsheet and a logbook app.

It's built for the U.S.-based contract pilot running their own 1099
business: flying day rates for several aircraft owners, management
companies, and Part 135 operators, invoicing each of them separately, and
keeping one logbook and one set of books across all of it.

This guide walks the product screen by screen, roughly in the order a new
pilot uses them: setting up the account, then the trip-to-invoice loop the
product is built around, then the rest of it: expenses, the logbook,
documents, reports, and the settings that shape how the app behaves. Every
screen also carries its own short explanation in the app itself, under
**Help** in the navigation rail, which is the place to look something up
mid-task. This is the place to read once, start to finish, before you do.

A handful of words are used the way pilots use them, not the way general
business software does: a certificate, not a licence; an aircraft, not a
plane; a leg is one flight and a trip is the whole assignment; PIC and SIC
are kept distinct; a day of work is typed as a duty day, a travel day,
standby, or off, and that type is what decides its rate.

## Contents

- [Getting started](#getting-started)
- [Clients](#clients)
- [Trips](#trips)
- [Invoicing](#invoicing)
- [Estimates](#estimates)
- [Expenses and receipts](#expenses-and-receipts)
- [The logbook](#the-logbook)
- [Aircraft and types](#aircraft-and-types)
- [Documents, qualifications, and currency](#documents-qualifications-and-currency)
- [Accounting](#accounting)
- [Reports](#reports)
- [Settings](#settings)
- [Your plan](#your-plan)
- [Getting your data out](#getting-your-data-out)
- [Getting help](#getting-help)

---

## Getting started

### Creating an account

Sign up with an email and password at `/signup`. V1 asks you to confirm
that address before you can sign in, so the first thing you see afterward
is a check-your-email screen. Open the link it sends, then come back and
log in.

Once you're signed in, you land on `/welcome`, where you choose a plan
(Solo, Pro, or Business; see [Your plan](#your-plan) for what separates
them) and a billing interval, monthly or annual. Every self-serve signup
starts with a trial, card required, and nothing is charged until the trial
ends. The exact trial length and the price of each tier and interval are
shown live on that screen, and again on Settings → Billing once you're in.
This guide doesn't restate a number that lives on a live billing record: a
number written here would only go stale.

Nothing is set up until payment is confirmed. If you're sent back to
`/welcome` after checkout and it says your workspace is being prepared,
that's normal and it resolves on its own, usually within seconds.

### Setting up your account

The first time you reach the dashboard, V1 asks for three things the
signup form deliberately left out:

1. **Your business identity**: legal name, address, and the details that
   should print on an invoice.
2. **Your airman profile**: certificate type and number, ratings.
3. **Your default rates**: day rate, travel day rate, per diem, and
   payment terms, which pre-fill your first trip and your first invoice.

Confirm whatever signup already carried over and fill in the rest. You do
this once; after that you land straight on the dashboard. Everything
entered here can be changed later at Settings → Your business, so none of
it has to be exactly right on day one.

### The loop the product is built around

Everything else follows from one idea: **the trip is the record.**

Log a trip once. Inside it, legs are the flying itself: departure,
arrival, aircraft, the time flown. A day grid covers every calendar day of
the trip, each one typed as a duty day, a travel day, standby, or off.
Each day type carries its own rate, set as a default per client and
overridable on the trip.

From a completed trip you can draft an invoice with the lines already
filled in, computed from the day grid and the rates the trip was actually
confirmed at rather than retyped by hand. The same trip proposes a
logbook entry for each leg, which you review before it becomes a
permanent entry. Any expense you file against the trip and mark billable
rides along on that same invoice, receipt attached.

One record in; an invoice, a logbook draft, and a filed expense out. The
rest of this guide is the detail behind each piece of that.

---

## Clients

A client is whoever you invoice: an aircraft owner, a management company,
a Part 135 operator you fly for on contract.

Rates set on a client (day rate, travel day rate, per diem, whatever
you've agreed) are defaults. Every trip can override them, and the rates
a trip was confirmed at are what its invoice uses, so renegotiating a rate
later never rewrites an invoice you already sent. A rate override on a
client sets what that one client pays per day type; leave it blank and the
day type's own default rate applies.

Not everyone you fly for gets billed directly. Turn off **You invoice this
client** for an operator you fly for but never send a bill to. They keep
their qualifications, documents, trips, and rates, and they simply drop
out of the invoice and estimate pickers, your unbilled-work list, and your
statements. Once you've actually invoiced or quoted somebody, that switch
can't be turned off; archive the client instead, which keeps every invoice
already sent and takes them out of new work going forward.

---

## Trips

A trip is the assignment: one or more legs, and the calendar days that
assignment covers.

**Legs** are the flying: departure, arrival, aircraft, block or flight
time.

**The day grid** is what you bill. Every calendar day in the trip gets a
type: a duty day, a travel day, standby, or off, and the type decides the
rate. Day types are yours to name and price (see [Settings](#settings)),
so "duty day" can read however your contracts actually word it while the
product still knows which rate applies.

Once a trip is complete, you can draft an invoice from it and review the
logbook entries it proposes for each leg. Neither happens automatically.
Both wait for you to look at the numbers first.

---

## Invoicing

### Drafting from a trip

An invoice drafted from a trip pulls its lines from that trip's day grid
and the rates it was confirmed at. The numbers on the invoice are the ones
you recorded on the trip, not ones you retype.

### Invoicing without a client

Not everything needs a trip or a client record. On a new invoice, choose
"No client, type the details" and enter who it bills by hand. A name is
required; an address and email are optional (without an email you'll send
the PDF yourself), and you add the lines directly. Use it for a one-off: a
ferry flight for an operator you won't fly for again, a training day, a
deposit, a cancellation fee.

An invoice with no client doesn't get a client's rate cards, monthly
minimums, agreed late fees, or scheduled reminders, because those are all
settings that live on a client record. You can still send a reminder by
hand, and the invoice still counts in your receivables, your aging, and
your reports exactly like any other. It won't appear on a client
statement, because a statement lists what one named client owes and this
invoice isn't theirs. Recurring schedules and estimates still require a
client, since both are standing arrangements with somebody specific.

### Statuses and numbering

An invoice is a draft until you send it. Sending is what assigns its
permanent number and stamps the date. A number, once minted, never
changes, including if you revise and re-send. From there an invoice moves
through sent, viewed, partly paid, paid, or overdue, depending on what
happens to it.

If you share a link to an invoice, V1 records when the client first opened
it and when they last did. That's a record of the link being fetched, not
proof a human read it. Voiding an invoice releases any rebilled expenses
attached to it, so they go back to unbilled and can be added to a
replacement.

### Payment reminders

Reminders are follow-ups on invoices already sent. They never change the
invoice itself, and a paid or voided invoice is never chased. Schedules
are per client and off by default; the daily reminder run also needs your
account's email sending configured, and the reminders screen (Settings →
Reminders) says plainly whether that scheduled run is actually switched
on, rather than implying it. If a client has opened the share link
recently, the schedule holds off automatically: chasing someone who's
already looking at the invoice reads as noise.

### Taking card and bank payments

Connect your own Stripe account at Settings → Payments → Connect with
Stripe, which hands you off to Stripe's own sign-in or account-creation
screen and back to Settings once you're connected. You are the merchant of
record: payments settle straight into your own Stripe balance, V1 never
sees your Stripe keys, never holds your funds, and never takes a cut of
what your clients pay you.

Once connected, any sent invoice can generate a payment link, and a
payment is recorded against the invoice automatically once the money
actually moves. A link's accepted payment methods are fixed when you
create it. Changing the setting doesn't change a link already sent, so
generate a new one after changing it. Bank payments (ACH) settle over
several business days; an invoice shows that a bank payment has started
before the money has actually landed, and only records it as paid once it
clears. Only an account owner can connect or disconnect Stripe.

### Recurring invoices

A recurring schedule drafts invoices on a repeating basis and puts each
one in a queue for you to confirm. Nothing sends itself without a human
looking at it first.

---

## Estimates

An estimate quotes a job before you fly it. You can send one, revise it,
and re-send it, and the number it was given the first time stays with it
through every revision.

Accepting an estimate lets you convert it straight to an invoice, carrying
its lines across so the quote and the bill can't drift apart from each
other.

---

## Expenses and receipts

### Scanning receipts

Photographing a receipt reads the vendor, date, and amount where it can.
Treat the result as a suggestion and check it before saving: a misread
total becomes a wrong number on an invoice.

### Rebilling and attribution

An expense filed against a trip and marked billable becomes an invoice
line when you bill that trip, with the receipt attached to the invoice
PDF. Rebilling requires a trip, since that's how the charge finds its way
onto an invoice; a client on its own has nowhere for the line to land.

A cost with no trip (training a client asked for, gear bought for one
owner's aircraft) can still name a client directly, so it counts toward
what that client has cost you even though it's never billed to them. Pick
a trip instead and the client comes from the trip automatically; the two
are never allowed to disagree.

### Bank and card import

Import a statement (CSV or OFX) and its transactions land in a review
queue rather than straight into your books. Nothing is filed until you
confirm it. Transactions are fingerprinted, so re-importing a statement
you've already loaded, or one with an overlapping date range, won't create
duplicates.

### Mileage

The IRS standard mileage rate changes every year, so V1 never assumes it.
You enter each year's rate yourself once you know it, at Settings →
Mileage. A mileage claim always uses the rate for the year the trip
happened, not the rate in force today, so a claim entered late still uses
the right number.

---

## The logbook

### Entries, drafts, and imports

You can write logbook entries directly, but most of yours will start as
drafts: completing a trip proposes an entry for each of its legs, and
nothing lands in your permanent logbook until you review the numbers and
confirm it.

You can also import from a logbook you already keep (ForeFlight, LogTen,
or a generic CSV) through the same upload-parse-preview-confirm sequence.
Nothing is added until you've reviewed the parsed rows and confirmed them
on the preview screen. And you can export everything in the other
direction as CSV. Importing into V1 doesn't make it your legal record of
flight time. Keeping that record is still yours: what's here is a copy
you can work from.

---

## Aircraft and types

Adding an aircraft groups every entry you've already logged in it,
however you spelled the registration at the time, under one tail number,
so the history stays connected even if past entries used slightly
different formatting.

Hours by type is the shape an insurance pilot-history form asks for.
Simulator time is tracked in its own column, separate from aircraft time,
because it isn't aircraft time.

---

## Documents, qualifications, and currency

### Documents and due dates

Certificates, medical, passport, insurance, W-9: enter the dates exactly
as printed on the document. Nothing here is calculated from anything else:
an issue date is never used to work out an expiry, because the document is
the authority and the product isn't. The dashboard's Overview shows what's
coming due from the dates you entered and nothing more. It doesn't
compute currency and it doesn't tell you whether you're legal to fly.
That judgment is yours and your operator's.

### Sending your credentials to a client

Every new client tends to ask for the same envelope: a W-9, a certificate
of insurance, sometimes a certificate or a medical. Rather than emailing
attachments by hand each time, you can generate a credential packet link
from your documents: a single revocable, expiring link that shares
exactly the documents you choose, nothing else in your document wallet.
The link expires by default, and you pick which documents it includes each
time you create one.

### Operator qualifications

Flying for a Part 135 operator means being qualified under that operator's
own certificate: their training, their checks, their programs. Being
personally typed and current is necessary, but it isn't sufficient on its
own. The qualifications V1 tracks per operator are a record of what that
client has told or shown you about your standing with them; it's a place
to keep track of it, not a determination that you're actually qualified.

Add an operator here the moment you sit their indoc, before there's any
work or any money attached. All it needs is a name, and it starts as
someone you don't invoice, so it stays out of your invoices, estimates,
and unbilled work until you say otherwise.

### Currency

A **Currency** screen exists in the navigation for tracking FAA currency
against your logbook. On a deployment where it isn't turned on, the
screen says so plainly rather than showing anything: no partial board, no
placeholder numbers.

---

## Accounting

Behind the screens you already use is a double-entry ledger. Invoices,
payments, and expenses post to it on their own; the journal (Accounting →
Journal) is where you see those postings and add anything that doesn't
have a screen of its own. Reconciliation (Accounting → Reconcile) compares
your ledger against an imported bank or card statement for a period, so
you can see what hasn't cleared yet.

---

## Reports

Every report below is generated from the same ledger the rest of the
product posts to, so a report and your invoices and expenses can't
disagree with each other.

- **Profit & loss**: income and expenses on a cash basis.
- **Cash flow**: money in and out over a period.
- **Balance sheet**: what you own and owe as of a date.
- **Trip profitability**: your clients ranked by margin, so you can see
  which relationships are actually worth the most, and which cost you the
  most.
- **Flight time**: cross-operator flight-time totals in the windows 14
  CFR 135.267 defines. It reports totals only, with no legality verdicts
  and no remaining-hours arithmetic.
- **Pilot history**: the numbers an underwriter, a management company, or
  a chief pilot asks a contract pilot for, compiled from your own logbook
  and documents. It's pure arithmetic over what you logged and recorded,
  with no currency conclusion and no statement about whether you're
  qualified.
- **Quarterly estimated tax**: a planning worksheet for the estimated
  payments most 1099 pilots owe four times a year.
- **Sales tax**: what your invoices charged as state or local tax and
  what's actually been collected in a period, the worksheet a filing
  preparer works from. It reports what was charged and collected, full
  stop: it never states what you owe or whether you need to register or
  file anywhere.
- **Year-end report**: a packet to hand to whoever prepares your taxes,
  including 1099-NEC reconciliation against the tax records you've kept
  for your own clients.

None of these are tax or legal advice. They're a presentation of your own
records, meant to be handed to the people who ask you for exactly this
shape of number: an accountant, an underwriter, a chief pilot.

---

## Settings

Settings is organized into groups, plus one tab that stands apart:

**Business**: Your business, Payments, Billing.
**Rates & categories**: Day types, Mileage, Categories.
**Communication**: Message wording, Reminders.
**Workspace**: Appearance, Layout.
**Profile & security** sits on its own, last, because it's the one tab
about the person signing in rather than the business.

### Your business

The legal name, address, and tax details that print on an invoice PDF and
on a shared invoice link. Your logo prints at the top of your invoices:
PNG or JPEG, up to 2 MB.

### Payments

Where you connect your own Stripe account so clients can pay an invoice
online. See [Taking card and bank payments](#taking-card-and-bank-payments)
above.

### Billing

What you pay for V1 itself: current plan, trial days remaining, next
charge and renewal date, the card on file, recent receipts, and the
controls to upgrade, downgrade, or cancel. See [Your plan](#your-plan).

### Day types

Rename any day type freely: the name is a label, and existing trips keep
working under the new one. Archive a day type you no longer use and it
stops appearing on new trips without touching the trips that already used
it. Which invoice line a day type bills as is fixed when you create it,
because changing that later would change what past work meant.

### Mileage

Per-tax-year IRS standard mileage rates, entered by you. See
[Expenses and receipts](#expenses-and-receipts), above.

### Categories

The words the pickers use across expenses, trips, and documents. Renaming
a category changes it everywhere at once, including on records filed
years ago. That's safe: the name is a label over a stable code
underneath, so nothing already saved actually moves. It just gets called
something else going forward.

### Message wording

Edits exactly one sentence: the opening line of the email a client
receives when you send an invoice, and a separate opening line for a
reminder. Both are saved once and reused on every send. Everything else in
that mail (the balance, part-payment reconciliation, the receipt count,
the payment link, the invoice's own notes, the sign-off in your business's
name) is a statement of fact about that particular invoice and isn't
editable from here.

### Reminders

Per-client reminder schedules, and whether the daily reminder run is
actually switched on for your account. See
[Payment reminders](#payment-reminders) above.

### Appearance

Theme choices (accent, density, light or dark) apply to your account on
every device you sign in from. They change nothing about your records,
your invoices, or what your clients see: an invoice PDF and a shared
invoice link look the same to a client no matter what you pick here.

### Layout

The order of sections in the navigation rail, and which of them show at
all. Hiding a section only removes it from the rail. The screen itself
and its records are untouched, and you can bring it back any time.

### Profile & security

This tab is about you, not your business: the name and address that
print on invoices live under Your business instead. Changing your sign-in
email doesn't take effect until you open the confirmation link sent to the
new address, and the screen shows a pending-change indicator in the
meantime. Changing your password asks for your current one first, so
someone who reaches an unlocked, signed-in screen can't lock you out by
changing it. Signing out other devices ends every other session and keeps
the one you're using right now.

---

## Your plan

V1 sells three tiers: **Solo**, **Pro**, and **Business**. Each is billed
monthly or annually, with a card-required trial before the first charge.
Exact pricing for every tier and interval is shown live on `/welcome`
before you choose, and again on Settings → Billing afterward, since that's
the only place a number can't drift from what you're actually charged.

The tiers don't gate safety or record-keeping. The logbook, the documents
wallet, the currency screen, and your operator qualification records stay
available on every tier for as long as you have an account. A working
pilot's own recordkeeping duty shouldn't depend on a subscription level.
What the tiers actually separate is business depth: the core get-paid
workflow (clients, trips, invoices, online payments, expenses) is in
Solo; estimates, client statements, recurring invoice schedules, the
accounting and bank-import layer, and the deeper tax reports sit above
it. Business adds seats for a second pilot or a bookkeeper, priced per
seat with a two-seat minimum. Inviting a seat beyond the two included
isn't self-serve yet: if you need a third seat today, say so directly
rather than looking for a button.

Downgrading never deletes anything. Records created on a higher tier stay
visible and exportable; what stops is creating new ones on screens outside
your new tier, and everything comes straight back the moment you upgrade
again.

---

## Getting your data out

Settings → Export hands back your records as CSV files you can open
elsewhere: one file per record type, no proprietary format and no zip to
unpack, the shape a spreadsheet, an accountant, or another piece of
software can actually read. It's there because leaving has to stay
possible: the work is yours, on every tier, whether or not you keep
paying for V1.

---

## Getting help

Every screen's own explanation lives in the app itself, under **Help** in
the navigation rail. It's searchable, and it's organized to be looked up
mid-task rather than read start to finish. This guide walks through the
same material in order; the in-app version stays close to the screens it
describes, for the moment you actually need a sentence of it.
