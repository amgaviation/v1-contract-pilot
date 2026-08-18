# Site map — v1-contract-pilot

## app/(marketing)
| URL | File | Description |
|---|---|---|
| / | app/(marketing)/page.tsx | Product landing page with pricing model, features, and mechanic walkthrough |
| /pricing | app/(marketing)/pricing/page.tsx | Three-tier pricing display table with features matrix and tier comparison |
| /terms | app/(marketing)/terms/page.tsx | Terms of Service counsel-gated placeholder (G3 launch gate) |
| /privacy | app/(marketing)/privacy/page.tsx | Privacy Policy counsel-gated placeholder (G3 launch gate) |

## app/(auth)
| URL | File | Description |
|---|---|---|
| /login | app/(auth)/login/page.tsx | Login form with next-path threading for deep linking |
| /signup | app/(auth)/signup/page.tsx | Sign-up form with INTRO_FIRST_MONTH_LABEL and plan pitch |
| /forgot-password | app/(auth)/forgot-password/page.tsx | Password recovery request (reachable while signed in) |
| /reset-password | app/(auth)/reset-password/page.tsx | Password reset form (accessible only with valid recovery session) |
| /check-email | app/(auth)/check-email/page.tsx | Email verification confirmation with address from httpOnly cookie |
| /link-expired | app/(auth)/link-expired/page.tsx | Expired confirmation/recovery link with resend action |
| /welcome | app/(auth)/welcome/page.tsx | Plan picker for signed-in user without tenant; starts Stripe checkout |

## app/(onboarding)
| URL | File | Description |
|---|---|---|
| /onboarding | app/(onboarding)/onboarding/page.tsx | First-run wizard: business identity, airman profile, rate/billing defaults |

## app/(app)
| URL | File | Description |
|---|---|---|
| /overview | app/(app)/overview/page.tsx | Dashboard with unbilled queue, awaiting payment, expiry alerts, key metrics |
| /accounting | app/(app)/accounting/page.tsx | Chart of accounts with live balances derived from ledger_sync RPC |
| /accounting/journal | app/(app)/accounting/journal/page.tsx | Ledger journal entries (200 per page) with full debit/credit detail |
| /accounting/reconcile | app/(app)/accounting/reconcile/page.tsx | Bank reconciliation UI with matched/unmatched transactions by month |
| /aircraft | app/(app)/aircraft/page.tsx | Fleet registry with time-by-tail, time-by-type, and operator notes |
| /clients | app/(app)/clients/page.tsx | Clients list with W-9 status, archived/active, operating rule |
| /clients/new | app/(app)/clients/new/page.tsx | New client form with seeded rates/terms from account defaults |
| /clients/[id] | app/(app)/clients/[id]/page.tsx | Client detail with rates, qualifications, cost panel, trip history |
| /clients/[id]/statement | app/(app)/clients/[id]/statement/page.tsx | Period statement of invoices issued, paid, and outstanding balance |
| /crew | app/(app)/crew/page.tsx | Crew members list (pilots and crew on record) |
| /crew/new | app/(app)/crew/new/page.tsx | New crew member form |
| /crew/[id] | app/(app)/crew/[id]/page.tsx | Crew member detail with archive button |
| /currency | app/(app)/currency/page.tsx | FAA currency board (five cards computed fresh from logbook; flag-gated) |
| /documents | app/(app)/documents/page.tsx | Documents (medical, 61.56, passport, certificate, insurance, W-9) with expiry ladder |
| /documents/new | app/(app)/documents/new/page.tsx | Add document with client picker and custom kind labels |
| /documents/[id] | app/(app)/documents/[id]/page.tsx | Document detail with edit and delete |
| /estimates | app/(app)/estimates/page.tsx | Estimates list with status, issue/expiry dates, value; filterable by open/accepted/declined/expired |
| /estimates/new | app/(app)/estimates/new/page.tsx | New estimate form for non-invoiced clients with day rates and terms |
| /estimates/[id] | app/(app)/estimates/[id]/page.tsx | Estimate detail with line editor, status actions (send/accept/decline), conversion to invoice |
| /expenses | app/(app)/expenses/page.tsx | Expenses list with category, vendor, trip/client attribution, unassigned queue |
| /expenses/new | app/(app)/expenses/new/page.tsx | Add expense with trip/client preselection via query params |
| /expenses/[id] | app/(app)/expenses/[id]/page.tsx | Expense detail with category, amount, receipt link, delete |
| /expenses/mileage | app/(app)/expenses/mileage/page.tsx | Mileage entries with year totals and per-mile rates |
| /expenses/import | app/(app)/expenses/import/page.tsx | Import bank statement (CSV/OFX/QFX) with browser-side parsing, preview, confirm |
| /expenses/transactions | app/(app)/expenses/transactions/page.tsx | Review unreviewed bank transactions, categorize, match to expenses, or dismiss |
| /help | app/(app)/help/page.tsx | Help browser: searchable user guide describing product features |
| /invoices | app/(app)/invoices/page.tsx | Invoices list with A/R aging, status badges, past-due count, bulk actions |
| /invoices/new | app/(app)/invoices/new/page.tsx | New invoice form with client picker, trip/line selection, tax, terms |
| /invoices/[id] | app/(app)/invoices/[id]/page.tsx | Invoice detail with line editor, PDF download, payment panel, reminder policy, share/send |
| /invoices/recurring | app/(app)/invoices/recurring/page.tsx | Recurring invoice schedules with generation history, due queue, autopay status |
| /logbook | app/(app)/logbook/page.tsx | Logbook entries (200 per page) with filterable views, hours-by-type, saved filters |
| /logbook/new | app/(app)/logbook/new/page.tsx | New logbook entry (manual or backfill) with fleet picker |
| /logbook/[id] | app/(app)/logbook/[id]/page.tsx | Logbook entry detail with source (manual/trip/import/ForeFlight), edit, delete |
| /logbook/drafts | app/(app)/logbook/drafts/page.tsx | Unconfirmed trip-derived logbook drafts (proposed from trip legs) |
| /logbook/import | app/(app)/logbook/import/page.tsx | Import logbook file (CSV/LogTen/ForeFlight) with browser parsing, preview, confirm |
| /logbook/aircraft | app/(app)/logbook/aircraft/page.tsx | Redirect stub to /aircraft (fleet screen promoted to top-level) |
| /receipts | app/(app)/receipts/page.tsx | Receipt shoebox: expenses with and without receipt_path, second read of expenses table |
| /reports | app/(app)/reports/page.tsx | Reports hub with links to tax, money, and flight-time reports |
| /reports/flight-time | app/(app)/reports/flight-time/page.tsx | Cross-operator flight-time totals in 14 CFR 135.267 windows (totals only, no verdicts) |
| /reports/cash-flow | app/(app)/reports/cash-flow/page.tsx | Cash flow statement by period with bank balance and cash receipt/disbursement detail |
| /reports/balance-sheet | app/(app)/reports/balance-sheet/page.tsx | Balance sheet as of a date (assets = liabilities + equity asserted) |
| /reports/pilot-history | app/(app)/reports/pilot-history/page.tsx | Pilot-history report: logbook totals and document statuses for underwriter/chief pilot |
| /reports/profit-loss | app/(app)/reports/profit-loss/page.tsx | P&L by year/quarter/month with prior-period comparison and bar chart |
| /reports/quarterly | app/(app)/reports/quarterly/page.tsx | Quarterly estimated tax cash-basis profit by IRS period with set-aside planner |
| /reports/sales-tax | app/(app)/reports/sales-tax/page.tsx | Sales tax charged and collected in period (cash basis) for filing preparer |
| /reports/trip-pl | app/(app)/reports/trip-pl/page.tsx | Trip profitability: per-trip and per-client margin with diverging bar chart |
| /reports/year-end | app/(app)/reports/year-end/page.tsx | Year-end report: income, deductions, 1099 reconciliation, travel log |
| /settings | app/(app)/settings/page.tsx | Settings hub: profile, business, rates, payment methods, reminders, appearance, categories |
| /settings/billing | app/(app)/settings/billing/page.tsx | Billing & plan: current plan, next charge, receipts, change/upgrade, cancel |
| /settings/billing/upgrade | app/(app)/settings/billing/upgrade/page.tsx | Upgrade prompt for over-tier access (feature explanation, upgrade button, no 404) |
| /settings/export | app/(app)/settings/export/page.tsx | Export data: per-entity CSV download links (clients, trips, expenses, invoices, logbook) |
| /trips | app/(app)/trips/page.tsx | Trips list with status, dates, client, aircraft, value, duplicate option |
| /trips/new | app/(app)/trips/new/page.tsx | New trip form with client picker, fleet, day rates, clone-from-last option |
| /trips/[id] | app/(app)/trips/[id]/page.tsx | Trip detail with leg editor, day grid, billing settlement, cost/revenue panel |

## Route handlers (route.ts) inside these groups
| URL | File | Description |
|---|---|---|
| GET /accounting/journal/export | app/(app)/accounting/journal/export/route.ts | Export journal entries as CSV |
| GET /clients/[id]/statement/print | app/(app)/clients/[id]/statement/print/route.ts | Print client statement as PDF/HTML |
| GET /logbook/export | app/(app)/logbook/export/route.ts | Export logbook entries as CSV (paginated to bypass 1000-row cap) |
| GET /reports/balance-sheet/export | app/(app)/reports/balance-sheet/export/route.ts | Export balance sheet as CSV |
| GET /reports/cash-flow/export | app/(app)/reports/cash-flow/export/route.ts | Export cash flow as CSV |
| GET /reports/flight-time/export | app/(app)/reports/flight-time/export/route.ts | Export flight-time totals as CSV |
| GET /reports/pilot-history/export | app/(app)/reports/pilot-history/export/route.ts | Export pilot-history report as CSV |
| GET /reports/profit-loss/export | app/(app)/reports/profit-loss/export/route.ts | Export P&L by period as CSV |
| GET /reports/quarterly/export | app/(app)/reports/quarterly/export/route.ts | Export quarterly estimated tax as CSV |
| GET /reports/sales-tax/export | app/(app)/reports/sales-tax/export/route.ts | Export sales tax detail as CSV |
| GET /reports/trip-pl/export | app/(app)/reports/trip-pl/export/route.ts | Export trip profitability as CSV |
| GET /reports/year-end/export | app/(app)/reports/year-end/export/route.ts | Export year-end report sections as CSV |
| GET /settings/export/[entity] | app/(app)/settings/export/[entity]/route.ts | Export record type (clients/trips/expenses/invoices/etc) as CSV with pagination |

## Additional route handlers (outside grouped routes)
| URL | File | Description |
|---|---|---|
| POST /auth/confirm | app/auth/confirm/route.ts | Email confirmation endpoint (password recovery, signup confirmation); exchanges token for session |
| POST /api/command-search | app/api/command-search/route.ts | Record search for command palette (clients/invoices/trips/estimates/expenses/documents) |
| POST /api/stripe/webhook | app/api/stripe/webhook/route.ts | Stripe platform-billing webhook (only tenant-creation path); handles checkout completion and subscription sync |
| POST /api/stripe/connect/callback | app/api/stripe/connect/callback/route.ts | Stripe Connect OAuth callback for payment method enrollment |
| POST /api/stripe/connect-webhook | app/api/stripe/connect-webhook/route.ts | Stripe Connect account webhook (payment method updates) |
| POST /api/autopay/start | app/api/autopay/start/route.ts | Enable autopay for recurring invoice schedule |
| POST /api/autopay/stop | app/api/autopay/stop/route.ts | Disable autopay for recurring invoice schedule |
| POST /api/reminders/run | app/api/reminders/run/route.ts | Background job: send invoice payment reminders based on policy |
| POST /api/holds/run | app/api/holds/run/route.ts | Background job: pause autopay charges if account is past-due |
| POST /app/sample-connect/refresh | app/sample-connect/refresh/route.ts | Refresh Sample Connect (Stripe test mode) test data |
| POST /api/stripe/sample-connect/webhook | app/api/stripe/sample-connect/webhook/route.ts | Sample Connect webhook for test data updates |
| POST /api/stripe/sample-connect/webhook-thin | app/api/stripe/sample-connect/webhook-thin/route.ts | Sample Connect thin webhook for rapid test |

## Public tokenized share surfaces (outside the four route groups; no session, no signup)
| URL | File | Description |
|---|---|---|
| /invoice/[token] | app/invoice/[token]/page.tsx | Client-facing invoice view a pilot shares with a client's AP desk; pay link when Stripe Connect is enrolled |
| /estimate/[token] | app/estimate/[token]/page.tsx | Client-facing estimate view with accept/decline actions |
| /packet/[token] | app/packet/[token]/page.tsx | Client-facing credential/insurance expiry packet |
| /vendor/[token] | app/vendor/[token]/page.tsx | Client-facing per-client rollup for a 135 operator's AP desk (invoices, credentials) |

## Navigation components
| File | Description |
|---|---|
| app/(app)/app-shell.tsx | Main authenticated app shell; renders header, dark rail (lg+) or horizontal strip (mobile), command palette provider, footer |
| app/(app)/nav-rail.tsx | Section navigation (client component using usePathname); links to 7 main sections + Settings + Help; marks current section with accent pill |
| app/(marketing)/site-header.tsx | Marketing site header; sticky navy bar with mark, How it Works, Pricing, Login, Get Started links |
| app/(marketing)/site-footer.tsx | Marketing site footer; navy bar with Product, Account, Legal column links and brand attribution |
| app/(app)/command-palette.tsx | Command palette (⌘K, client component); searches records by name/number + fuzzy-filters nav links; uses LDialogShell + cmdk primitives |

## Non-navigation components
Total 10 components across ledger/charts/utility folders: form inputs, tables, icons, logo, dialog shell, segmented controls, charts (period comparison, item margin bar), tabs.

## Layouts
| Route Group | Layout File | Chrome Provided |
|---|---|---|
| app/(marketing) | app/(marketing)/layout.tsx | SiteHeader, SiteFooter; full-bleed bands with navy hero; controls robots/noindex for preview deployments |
| app/(auth) | app/(auth)/layout.tsx | AuthBrand (mark + back-to-site link), AuthColumn (narrow, centered auth surface), tagline; v1-nozoom-fields class for touch font-size |
| app/(onboarding) | app/(onboarding)/layout.tsx | Slim header with mark and "Account setup" label; 44rem container for wizard form |
| app/(app) | app/(app)/layout.tsx | AppShell with session reads; theme/nav layout from preferences; accountLogoUrl fallback; account-status read-only banner |
