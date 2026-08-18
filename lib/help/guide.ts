/**
 * ===========================================================================
 * THE USER GUIDE — content, and the search over it
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS. Every screen in this product used to carry a
 * paragraph under its heading explaining what the screen was for. That
 * explanation is worth having and is in the wrong place: it is read once,
 * ignored forever after, and spends permanent vertical space on a phone
 * where the pilot is trying to reach the form. The paragraphs were removed
 * from the screens and the knowledge moved HERE, where it is looked up on
 * purpose and can be searched.
 *
 * Nothing was deleted in the move. Every topic below carries the substance
 * of the copy it replaced — including the consequences that copy warned
 * about, which are the parts worth keeping.
 *
 * PLAIN DATA, NOT COMPONENTS. Topics are values, not JSX, so the search
 * below is a pure function over strings and can be tested without a
 * renderer (tests/help-guide.test.mjs). It also means one topic renders
 * identically in the list, in a search result, and anywhere else it is
 * shown later.
 *
 * TERMINOLOGY. This is pilot-facing writing: certificate not licence,
 * aircraft not plane, leg and trip, tail number, recurrent not renewal,
 * due month not expiry. See the aviation reference the product is built
 * against; a guide that uses the wrong word teaches the wrong word.
 */

export type HelpTopic = {
  /** Stable id — used as the anchor and the React key. */
  id: string;
  title: string;
  /** One line. What this is, in the words a pilot would use. */
  summary: string;
  /** The screen this is about, when there is one to open. */
  href?: string;
  /** Paragraphs. Plain strings; no markup. */
  body: readonly string[];
  /**
   * Extra search terms that do not appear in the prose — synonyms, the
   * words someone types when they do not know this product's name for a
   * thing ("mileage" for the IRS rate, "chase" for reminders).
   */
  keywords?: readonly string[];
};

export type HelpSection = {
  id: string;
  title: string;
  topics: readonly HelpTopic[];
};

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    topics: [
      {
        id: "creating-account",
        title: "Creating your account",
        summary: "Sign up, confirm your email, and start your trial.",
        body: [
          "Sign up with an email and password. You confirm that address before you can sign in, so the first thing you see afterward is a check-your-email screen — open the link it sends, then come back and log in.",
          "Once you are signed in you land on the plan screen, where you choose a tier and a billing interval and start a trial, card required. The exact trial length and the price of each tier and interval are shown live there, and again on Settings → Billing once you are in, so nothing here restates a number that could go stale.",
          "Nothing is set up until payment is confirmed. If you are sent back to the plan screen after checkout and it says your workspace is being prepared, that is normal and resolves on its own within seconds.",
        ],
        keywords: ["signup", "sign up", "trial", "plan", "welcome", "confirm email"],
      },
      {
        id: "account-setup",
        title: "Setting up your account",
        summary: "The three things this product asks for the first time you reach the dashboard.",
        href: "/settings",
        body: [
          "The first time you reach the dashboard, you are asked for three things the signup form deliberately left out: your business identity (legal name, address, the details that should print on an invoice), your airman profile (certificate type and number, ratings), and your default rates (day rate, travel day rate, per diem, payment terms), which pre-fill your first trip and your first invoice.",
          "Confirm whatever signup already carried over and fill in the rest. You do this once; everything entered here can be changed later at Settings → Your business, so none of it has to be exactly right on day one.",
        ],
        keywords: ["onboarding", "business identity", "airman profile", "default rates", "certificate"],
      },
      {
        id: "how-v1-works",
        title: "The idea behind this product",
        summary: "Log a trip once; the invoice, the logbook draft, and the receipts come from it.",
        href: "/trips",
        body: [
          "Everything else follows from one idea: the trip is the record. Log a trip once, and legs are the flying itself while a day grid covers every calendar day of the trip, each one typed as a duty day, a travel day, standby, or off — the type that decides its rate.",
          "From a completed trip you can draft an invoice with the lines already filled in, propose a logbook entry for each leg for you to review, and attach any billable expense filed against it. One record in; an invoice, a logbook draft, and a filed expense out.",
        ],
        keywords: ["overview", "workflow", "trip is the record", "how it works"],
      },
    ],
  },
  {
    id: "getting-paid",
    title: "Getting paid",
    topics: [
      {
        id: "trips-to-invoice",
        title: "From a trip to an invoice",
        summary: "Start with the trip; the invoice lines and the logbook draft come from it.",
        href: "/trips",
        body: [
          "A trip is the assignment. Inside it, legs are the flying and the day grid is what you bill: each calendar day is typed as a duty day, a travel day, standby, or off, and each type carries its own rate.",
          "Picking a client is not required to start a trip: like an invoice, a trip can exist with no client attached yet and have one added later.",
          "Once a trip is complete you can draft an invoice straight from it. The lines come from the day grid and the rates agreed with that client, so the numbers on the invoice are the ones you recorded, not ones you retype.",
          "The same trip also produces a logbook draft for each leg, which you review before it becomes a logbook entry. One capture, several outputs.",
        ],
        keywords: ["day grid", "day rate", "billing", "legs", "duty day", "travel day", "no client"],
      },
      {
        id: "invoice-without-a-client",
        title: "Invoicing without a client",
        summary: "Raise an invoice with the bill-to details typed in, no client record and no trip.",
        href: "/invoices",
        body: [
          "On a new invoice, pick \u201cNo client, type the details\u201d and enter who it bills. You need a name; an address and an email are optional, though without an email you send the PDF yourself. Then add the lines by hand. No trip has to exist and no client record is created.",
          "Use it for a one-off: a ferry flight for an operator you will not fly for again, a training day, a deposit, a cancellation fee.",
          "What an invoice with no client does not get: rate cards, monthly minimums, an agreed late fee, and scheduled reminders. All four are settings that live on a client. You can still send a reminder by hand, and the invoice counts in your receivables, your aging and your reports exactly like any other.",
          "It does not appear on any client statement, because a statement lists what one named client owes and this invoice is not theirs.",
          "Recurring schedules and estimates still need a client. Both are standing arrangements with somebody, so the payer is worth a record.",
        ],
        keywords: [
          "one off",
          "ad hoc",
          "no client",
          "bill to",
          "blank invoice",
          "manual invoice",
          "ferry",
        ],
      },
      {
        id: "invoice-lifecycle",
        title: "Invoice statuses",
        summary: "Draft, sent, viewed, partly paid, paid, overdue: what moves an invoice between them.",
        href: "/invoices",
        body: [
          "An invoice is a draft until you send it. Sending assigns its permanent number and stamps the date; a number, once minted, never changes, including if you revise and re-send.",
          "If you share a link, the invoice records when the client first opened it and when they last did. That is a record of the link being fetched, not proof a human read it.",
          "Voiding an invoice releases any rebilled expenses attached to it, so they become unbilled again and can go on a replacement.",
          "Paid by check, wire, or cash instead of through a payment link? Record the payment by hand on the invoice itself. That moves its status the same way an online payment does, and it is what stops a scheduled reminder from continuing to chase an invoice that is actually settled.",
        ],
        keywords: ["void", "numbering", "share link", "viewed", "overdue", "aging", "partial payment", "record payment", "manual payment", "offline payment", "mark paid"],
      },
      {
        id: "reminders",
        title: "Payment reminders",
        summary: "Follow-ups on invoices already out, sent in your name on the schedule you set per client.",
        href: "/settings?tab=reminders",
        body: [
          "Reminders never change an invoice, and a paid or voided one is never chased.",
          "Schedules are per client and off until you set one. The daily run also needs the email service configured; the reminders screen says plainly whether the scheduled run is switched on, rather than implying it.",
          "If a client has opened the share link recently, the schedule holds off. Chasing someone who is looking at the invoice reads as noise.",
        ],
        keywords: ["chase", "follow up", "overdue", "dunning", "late"],
      },
      {
        id: "message-wording",
        title: "Message wording",
        summary: "The one sentence you can edit in the emails sent in your name.",
        href: "/settings?tab=messages",
        body: [
          "Settings → Message wording edits exactly one sentence: the opening line of the email a client receives when you send an invoice, and a separate opening line for a reminder. Both are saved once and reused on every send.",
          "Everything else in that mail — the balance, part-payment reconciliation, the receipt count, the payment link, the invoice's own notes, the sign-off in your business's name — is a statement of fact about that particular invoice and is not editable from here.",
        ],
        keywords: ["email template", "opening line", "wording", "copy", "message"],
      },
      {
        id: "online-payments",
        title: "Taking card and bank payments",
        summary: "Connect your own Stripe account so clients can pay an invoice online.",
        href: "/settings?tab=payments",
        body: [
          "You are the merchant of record. Payments settle straight into your own Stripe balance: this platform never sees your Stripe keys, never holds your funds, and never takes a cut of what your clients pay you.",
          "Once connected, any sent invoice can generate a payment link. When the money actually settles, the payment is recorded against the invoice automatically.",
          "A payment link's options are fixed when the link is created. Changing which methods you accept does not change a link you have already sent. Change the setting, then generate a new link.",
          "Bank payments (ACH) settle over several business days. An invoice will show that a bank payment was started before the money has moved, and the payment is only recorded when it clears.",
        ],
        keywords: ["stripe", "connect", "ach", "card", "payment link", "merchant"],
      },
      {
        id: "estimates",
        title: "Estimates",
        summary: "Quote a job, then convert the accepted quote into an invoice.",
        href: "/estimates",
        body: [
          "An estimate can be sent, revised, and re-sent. The number it was given the first time stays with it through the round trip.",
          "Accepting an estimate lets you convert it to an invoice, carrying its lines across so the quote and the bill cannot drift apart.",
        ],
        keywords: ["quote", "proposal", "convert"],
      },
    ],
  },
  {
    id: "money-in-out",
    title: "Money in and out",
    topics: [
      {
        id: "expenses",
        title: "Expenses and receipts",
        summary: "Photograph a receipt, file it, and rebill it to the client when it belongs to a trip.",
        href: "/expenses",
        body: [
          "Scanning a receipt reads the vendor, date, and amount where it can. It is a suggestion: check it before saving, because a misread total becomes a wrong number on an invoice.",
          "An expense filed against a trip and marked billable becomes an invoice line when you bill that trip, with the receipt attached to the invoice PDF.",
          "A cost with no trip can still name a client, so training a client asked for or gear bought for one owner's aircraft counts toward what that client has cost you. Pick a trip and the client comes from the trip instead, because the two are never allowed to disagree.",
          "Rebilling still needs a trip. A client on its own gives the charge nowhere to land, since the line goes on the invoice through the trip.",
        ],
        keywords: [
          "receipt",
          "ocr",
          "scan",
          "rebill",
          "reimbursable",
          "billable",
          "client",
          "attribute",
        ],
      },
      {
        id: "bank-import",
        title: "Bank and card import",
        summary: "Import a statement, then review each transaction before it becomes an expense.",
        href: "/expenses/import",
        body: [
          "Imported transactions land in a review queue rather than straight into your books. Nothing is filed until you confirm it.",
          "Re-importing a statement you have already loaded does not duplicate what is in it. Transactions are fingerprinted, so an overlapping date range is safe.",
        ],
        keywords: ["csv", "ofx", "statement", "reconcile", "transactions"],
      },
      {
        id: "mileage",
        title: "Mileage",
        summary: "Per-year rates, entered by you.",
        href: "/settings?tab=mileage",
        body: [
          "The IRS standard mileage rate changes every year, so it is entered here per tax year and never assumed by this product. Add each year's rate once you know it.",
          "A mileage claim uses the rate for the year of the trip, not the rate in force today, so a claim entered late still uses the right number.",
        ],
        keywords: ["irs", "rate", "driving", "car", "deduction"],
      },
      {
        id: "accounting",
        title: "Accounting and the journal",
        summary: "A double-entry ledger behind the screens you already use.",
        href: "/accounting",
        body: [
          "Invoices, payments and expenses post to the ledger on their own. The journal is where you see those postings and add anything that has no screen of its own.",
          "Reconciliation compares your ledger against an imported statement for a period, so you can see what has not cleared.",
        ],
        keywords: ["ledger", "double entry", "journal", "chart of accounts", "reconcile", "bookkeeping"],
      },
    ],
  },
  {
    id: "flying-records",
    title: "Flying and records",
    topics: [
      {
        id: "logbook",
        title: "Logbook",
        summary: "Entries you write, drafts from trips, and imports from the logbook you already keep.",
        href: "/logbook",
        body: [
          "Trip legs produce logbook drafts. A draft is not an entry: you review the numbers, then commit it.",
          "You can import from an existing logbook and export what is here. Importing does not make this your legal record: keeping that record is yours, and this is a copy you can work from.",
        ],
        keywords: ["hours", "flight time", "pic", "sic", "night", "approaches", "import", "export", "foreflight", "logten"],
      },
      {
        id: "aircraft",
        title: "Aircraft and types",
        summary: "Tail numbers you have flown, grouped so time in type adds up.",
        href: "/logbook/aircraft",
        body: [
          "Adding an aircraft groups every entry you already logged in it, however you spelled the registration at the time, under one tail number.",
          "Hours by type is the shape an insurance pilot-history form asks for. Simulator time is kept in its own column because it is not aircraft time.",
        ],
        keywords: ["tail number", "n-number", "registration", "type rating", "time in type", "simulator"],
      },
      {
        id: "documents",
        title: "Documents and due dates",
        summary: "Certificates, medical, passport, insurance, with the dates printed on them.",
        href: "/documents",
        body: [
          "Enter the dates exactly as printed on the document. Nothing here is calculated from anything else: an issue date is not used to work out an expiry, because the document is the authority and the product is not.",
          "Overview shows what is coming due. It shows the dates you entered and nothing more: it does not compute currency or tell you whether you are legal to fly. That judgement is yours and the operator's.",
          "Every new client tends to ask for the same envelope: a W-9, a certificate of insurance, sometimes a certificate or a medical. Rather than emailing attachments by hand each time, generate a credential packet link from your documents: a single revocable, expiring link that shares exactly the documents you choose, nothing else in your document wallet. The link expires by default, and you pick which documents it includes each time you create one.",
        ],
        keywords: ["medical", "passport", "expiry", "due", "insurance", "coi", "w-9", "certificate", "packet", "credential", "share"],
      },
      {
        id: "operator-quals",
        title: "Operator qualifications",
        summary: "Where you stand on a particular operator's certificate.",
        href: "/clients",
        body: [
          "Flying for a Part 135 operator means being qualified under that operator's certificate: their training, their checks, their programs. Being typed and current personally is necessary and not sufficient.",
          "These records are what a client has told or shown you about your standing with them. They are a place to keep track of it, not a determination that you are qualified.",
          "Add an operator from this panel the moment you sit their indoc, before there is any work or any money. All it needs is a name. They start as someone you do not invoice, so they stay out of your invoices, estimates and unbilled work until you say otherwise.",
        ],
        keywords: ["135", "part 135", "checkride", "recurrent", "training", "ipc", "line check", "indoc", "operator"],
      },
      {
        id: "currency",
        title: "Currency",
        summary: "A screen for tracking FAA currency against your logbook.",
        href: "/currency",
        body: [
          "The Currency screen is not a tier feature: it switches on for the whole product at once, and stays off for every account until it does. Until then the screen says so plainly rather than showing anything — no partial board, no placeholder numbers.",
        ],
        keywords: ["currency", "faa", "recency", "landings", "instrument"],
      },
    ],
  },
  {
    id: "clients-setup",
    title: "Clients and setup",
    topics: [
      {
        id: "clients",
        title: "Clients and rates",
        summary: "Who you fly for, what they pay, and what their agreement says.",
        href: "/clients",
        body: [
          "Rates set on a client are defaults. Every trip can override them, and the rates a trip was confirmed at are what its invoice uses. Renegotiating later does not rewrite work already done.",
          "A rate override sets what this client pays per day type. Left blank, the day type's own default applies.",
          "Turn off \u201cYou invoice this client\u201d for an operator you fly for but never bill. They keep their qualifications, documents, trips and rates, and they drop out of the invoice and estimate pickers, your unbilled work and your statements. Once you have invoiced or quoted somebody you cannot turn it off: archive them instead, which keeps the invoices and takes them out of new work.",
          "The same toggle handles a common arrangement: you fly for an aircraft owner directly, but a management company actually pays you. Add both as clients. Turn off \u201cYou invoice this client\u201d on the owner, so their qualifications and documents are still tracked but they never show up as someone you bill, and send invoices to the management company instead.",
        ],
        keywords: ["operator", "owner", "rate", "day rate", "per diem", "terms", "contract", "not invoiced", "billing", "management company"],
      },
      {
        id: "day-types",
        title: "Day types",
        summary: "What a day of work is called on your trips, and how it bills.",
        href: "/settings?tab=day-types",
        body: [
          "Rename any of these freely; the name is a label and the trips keep working. Archive one you no longer use and it stops appearing on new trips without touching the ones that already used it.",
          "Which invoice line a day type bills as is fixed when you create it, because changing it later would change what past work meant.",
        ],
        keywords: ["duty", "travel", "standby", "off", "rate"],
      },
      {
        id: "categories",
        title: "Categories",
        summary: "The words the pickers use for expenses, trips and documents.",
        href: "/settings?tab=categories",
        body: [
          "Renaming a category changes it everywhere at once, including on records you filed years ago. That is safe: the name is a label over a stable code underneath, so nothing you have already saved moves. It just gets called something else.",
        ],
        keywords: ["rename", "labels", "expense category", "picker"],
      },
      {
        id: "business-record",
        title: "Your business details",
        summary: "What prints on the invoices your clients receive.",
        href: "/settings",
        body: [
          "The legal name, address and tax details here are what appear on an invoice PDF and on a shared invoice link.",
          "Your logo prints at the top of your invoices. PNG or JPEG, up to 2 MB.",
        ],
        keywords: ["legal name", "address", "ein", "w-9", "logo", "invoice header"],
      },
      {
        id: "appearance-layout",
        title: "Appearance and navigation",
        summary: "How the product looks and which sections the rail shows.",
        href: "/settings?tab=appearance",
        body: [
          "Appearance applies to this account on every device you sign in from. It changes nothing about your records, your invoices, or what your clients see: an invoice PDF and a shared invoice link look the same to them whatever you pick.",
          "Navigation sets the order of the sections in the rail and which of them it shows. Hiding a section only takes it out of the rail; the screen still exists and its records are untouched.",
        ],
        keywords: ["theme", "dark mode", "accent", "density", "rail", "hide", "reorder"],
      },
      {
        id: "profile-security",
        title: "Profile and security",
        summary: "How you sign in, separate from your business details.",
        href: "/settings?tab=profile",
        body: [
          "This is about you, not your business. The name and address that print on invoices live in your business details.",
          "Changing your sign-in email does not take effect until you open the link sent to the new address. Changing your password asks for the current one first, so someone who reaches an unlocked screen cannot lock you out.",
          "Signing out other devices ends every other session and keeps the one you are using.",
        ],
        keywords: ["password", "email", "sign out", "sessions", "2fa", "security"],
      },
    ],
  },
  {
    id: "reports-plans",
    title: "Reports and your plan",
    topics: [
      {
        id: "reports",
        title: "Reports",
        summary: "What you earned, what you owe, and the forms other people ask you for.",
        href: "/reports",
        body: [
          "Profit and loss, cash flow and the balance sheet come from the same ledger the rest of the product posts to, so they agree with your invoices and expenses by construction.",
          "The year-end packet and the quarterly summary are there to hand to whoever prepares your taxes. They are a presentation of your own records, not tax advice.",
          "Pilot history is the arithmetic an insurer or a chief pilot asks for: totals by category, class and type, with recent windows. It reports hours you logged; it makes no claim about currency or legality.",
          "Trip profitability ranks your clients by margin, so you can see which relationships are actually worth the most, and which cost you the most. Flight time totals cross-operator flying in the windows 14 CFR 135.267 defines, totals only, with no legality verdicts. Sales tax reports what your invoices charged and what has actually been collected in a period, the worksheet a filing preparer works from — it never states what you owe or whether you need to register or file anywhere.",
        ],
        keywords: ["p&l", "profit", "tax", "quarterly", "1099", "year end", "cpa", "pilot history", "flight time", "trip profitability", "margin", "sales tax", "135.267"],
      },
      {
        id: "plans-billing",
        title: "Your plan",
        summary: "What you pay for this product, and what each plan opens.",
        href: "/settings/billing",
        body: [
          "The billing screen shows your current plan, what is next to be charged and when, the card on file, and recent receipts.",
          "Every amount shown comes from the live subscription, and the feature list is generated from the same table the product gates on, so what a plan opens cannot drift from what it says.",
          "There are three tiers, Solo, Pro and Business, and none of them gate safety or record-keeping: the logbook, the documents wallet, the currency screen and your operator qualification records stay available on every tier for as long as you have an account. What the tiers separate is business depth — estimates, client statements, recurring invoice schedules, the accounting and bank-import layer and the deeper tax reports sit above Solo. Business bills per seat with a two-seat minimum, so your own login and one more, a co-pilot's or a bookkeeper's, are what you are paying for and what you get; a third seat is not self-serve yet.",
          "Downgrading and cancelling are different things. Downgrade a tier and records created above your new tier stay visible and exportable — only creating new ones on those screens stops, and everything comes straight back the moment you upgrade again. Cancel outright and the account goes read-only rather than disappearing: every page still loads, export still works, and nothing already recorded, including your logbook, is ever deleted, but nothing new can be recorded until you reactivate.",
        ],
        keywords: ["subscription", "upgrade", "downgrade", "cancel", "trial", "invoice", "receipt", "seats", "solo", "pro", "business", "tier", "read-only"],
      },
      {
        id: "account-lifecycle",
        title: "Deactivating, starting over, deleting",
        summary: "The three ways out, and exactly what each one keeps.",
        href: "/settings?tab=account",
        body: [
          "Deactivating ends your subscription and puts the account in read-only. Every record is kept and stays exportable, and you can re-subscribe whenever you want it back. Nothing is deleted. The part of the period you already paid for is not refunded.",
          "Starting over clears every record you have entered — clients, trips, invoices, estimates, expenses, and your logbook, aircraft and documents — and keeps the account itself, your settings and your subscription. It is the only thing in this product that deletes a logbook, and it cannot be undone.",
          "Deleting removes the account and everything in it, ends the subscription, and signs you out. Support cannot recover it afterwards.",
          "Your invoice numbering survives all three. A future invoice can never reuse a number a client has already been sent, which is why the counter keeps counting even when what it counted is gone.",
          "All three ask for your password, and the two that destroy records also ask you to type your business name back. Export first: it is the one step that cannot be taken afterwards.",
          "Only the account owner can do any of this.",
        ],
        keywords: [
          "delete account",
          "deactivate",
          "close account",
          "cancel",
          "reset",
          "start over",
          "wipe",
          "erase",
          "leave",
          "quit",
        ],
      },
      {
        id: "export",
        title: "Getting your data out",
        summary: "Your records, in files you keep.",
        href: "/settings/export",
        body: [
          "The export hands back your records as files you can open elsewhere. It is there so that leaving is possible: your work is yours.",
        ],
        keywords: ["export", "csv", "download", "backup", "leave", "data"],
      },
    ],
  },
];

/** Every topic, flattened — the corpus search runs over. */
export const HELP_TOPICS: readonly HelpTopic[] = HELP_SECTIONS.flatMap((s) => s.topics);

/**
 * The text a topic can be found by. Title, summary, body and keywords, so
 * typing a word that appears anywhere in the answer finds it — not only
 * words in the heading, which is the failure mode of a title-only search
 * ("mileage" not finding the IRS-rate topic because the heading says
 * "Mileage" but the useful sentence is three lines down).
 */
function haystack(topic: HelpTopic): string {
  return [topic.title, topic.summary, ...topic.body, ...(topic.keywords ?? [])]
    .join(" ")
    .toLowerCase();
}

/**
 * Search the guide.
 *
 * EVERY WORD MUST MATCH, not any: someone typing "invoice reminder" means
 * both, and an any-word search would return most of the guide because
 * "invoice" is everywhere. Substring rather than whole-word, so "remind"
 * finds "reminders" and a half-typed query narrows as you go.
 *
 * An empty or whitespace query returns everything, which is what makes the
 * page render as a browsable guide before anyone types.
 */
export function searchHelp(
  query: string,
  topics: readonly HelpTopic[] = HELP_TOPICS
): readonly HelpTopic[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return topics;
  return topics.filter((topic) => {
    const text = haystack(topic);
    return terms.every((term) => text.includes(term));
  });
}

/** The sections, with their topics filtered — empty sections dropped. */
export function searchHelpSections(
  query: string,
  sections: readonly HelpSection[] = HELP_SECTIONS
): readonly HelpSection[] {
  const matched = new Set(searchHelp(query).map((t) => t.id));
  return sections
    .map((section) => ({
      ...section,
      topics: section.topics.filter((topic) => matched.has(topic.id)),
    }))
    .filter((section) => section.topics.length > 0);
}
