# Sample Stripe Connect integration

A working, self-contained demonstration of Stripe Connect with **V2 accounts**:
merchant onboarding, products, a public storefront, direct charges with an
application fee, a platform subscription, and both styles of webhook.

Added 2026-08-14 against `stripe` 22.5.0 (which pins API version
`2026-07-29.dahlia` automatically).

---

## Read this first: there are now TWO Connect integrations here

They do different things and **must not be mixed**.

| | Production (`lib/stripe/`) | Sample (`lib/sample-connect/`) |
|---|---|---|
| Purpose | pilots invoicing their real clients | demonstration |
| Account model | Connect **Standard**, linked by OAuth | **V2 accounts**, created by us |
| Onboarding | `connect.stripe.com/oauth/authorize` | **V2 Account Links** |
| Platform cut | **none** — promised in the pilot-facing UI | **application fee** (2.5%) |
| Products | none; invoices are the unit | Stripe Products on the connected account |
| Storefront | none | public page per merchant |
| Account id stored in | `pilot.accounts.connect_account_id` | `pilot.sample_connect_accounts` |
| Entry point | Settings → Business | `/sample-connect` |

**They share only the Stripe secret key**, because they are the same platform.
Nothing else crosses: the sample never reads or writes
`pilot.accounts.connect_account_id`, and the production flow never sees a V2
account id. Writing a V2 id into that column would put an account the OAuth
flow never granted in front of code that assumes it did, and the first symptom
would be a real pilot's payment link failing.

To remove the sample entirely: delete `lib/sample-connect/`,
`app/sample-connect/`, `app/store/`, `app/api/stripe/sample-connect/`, drop
`pilot.sample_connect_accounts`, and remove the `/store/` entry from the
middleware allow-list in `lib/supabase/proxy.ts`.

---

## What is where

```
lib/sample-connect/
  client.ts      the Stripe client, env guards, application-fee maths
  accounts.ts    V2 account create / Account Link / live status
  products.ts    products on the connected account (Stripe-Account header)
  checkout.ts    storefront charges AND the platform subscription
  store.ts       the user → account mapping (the only thing persisted)

app/sample-connect/
  page.tsx           merchant dashboard (authenticated)
  actions.ts         server actions
  product-form.tsx   the add-a-product form
  refresh/route.ts   Account Link refresh_url handler

app/store/[accountId]/
  page.tsx           public storefront
  actions.ts         the "Buy" action
  success/page.tsx   post-checkout confirmation

app/api/stripe/sample-connect/
  webhook-thin/route.ts   V2 account events   (THIN payloads)
  webhook/route.ts        subscription events (SNAPSHOT payloads)

supabase/migrations/20260814130000_sample_connect_accounts.sql
```

---

## Setup

### 1. Environment

`STRIPE_SECRET_KEY` is already required by this app. The sample adds three
variables, all documented in `.env.example`:

```
SAMPLE_CONNECT_PLATFORM_PRICE_ID=price_1U4My3CsUD8TlMqiaidAYrQk
SAMPLE_CONNECT_WEBHOOK_SECRET=whsec_...
SAMPLE_CONNECT_THIN_WEBHOOK_SECRET=whsec_...
```

The price id above is a **real test-mode Price** ($20/month, "Sample Connect
Platform Plan") created on this account, so the subscription flow works
immediately in test mode. Replace it for any other account.

Leave any of them unset and the sample says which one is missing rather than
throwing — every entry point checks configuration first.

### 2. Database

Apply `supabase/migrations/20260814130000_sample_connect_accounts.sql`. It adds
one table with RLS on and policies scoped to the row's owner. It touches
nothing that exists.

### 3. Enable Connect

Stripe Dashboard → Connect. The sample creates accounts itself through the V2
API, so there is no OAuth client id and no redirect URI to register — that is
the production integration's requirement, not this one.

**Do this before creating the webhook destinations.** Until the account is set
up as a Connect platform, the destination form warns *"Your account is not set
up as a Connect platform"* and Connect events are not delivered, whichever
scope you pick.

### 4. Webhooks

Two endpoints, **two different payload styles**, two different secrets.

**V2 account events — thin:**

```bash
stripe listen \
  --thin-events 'v2.core.account[requirements].updated,v2.core.account[configuration.merchant].capability_status_updated,v2.core.account[configuration.customer].capability_status_updated' \
  --forward-thin-to localhost:3000/api/stripe/sample-connect/webhook-thin
```

In the dashboard: *Events from* → **Your account** (not "Connected accounts" —
see below), *Show advanced options* → *Payload style* → **Thin**.

> **The V2 routing rule, which is the opposite of what you'd guess.** Stripe's
> dashboard says it plainly: *"Accounts v2 events route differently than v1.
> Events for v2 accounts that belong directly to your platform are delivered to
> **Your account** destinations — not **Connected accounts** as in v1. Events
> for v2 accounts that belong to your connected accounts (such as their
> customers and recipients) are delivered to **Connected accounts**
> destinations. To receive both, create two separate destinations."*
>
> This sample creates v2 accounts as the platform, so they belong directly to
> it and their events land on the **platform** scope. Choose "Connected
> accounts" and this endpoint silently receives nothing.
>
> The production integration in this same repo needs the **opposite** setting
> (`/api/stripe/connect-webhook` genuinely is "events on connected accounts"),
> because it handles V1-style direct charges on Standard accounts. Both are
> correct. Don't reconcile them.

Both sample endpoints therefore sit on the **Your account** scope: the thin one
above and the snapshot one below.

If the dashboard warns *"Your account is not set up as a Connect platform"*,
enable Connect first at
[dashboard.stripe.com/connect](https://dashboard.stripe.com/connect) — until
then no Connect events of any scope are delivered.

**Subscription events — snapshot:**

```bash
stripe listen --forward-to localhost:3000/api/stripe/sample-connect/webhook
```

In the dashboard: *Events from* → **Your account** (the opposite of the thin
endpoint — these are your charges, not the merchant's).

---

## The five flows

### 1. Onboarding

`/sample-connect` → **Onboard to collect payments**. Creates a V2 account
(`dashboard: 'full'`, merchant + customer configurations, `card_payments`
requested) and redirects into Stripe-hosted onboarding via an Account Link.

Account Links are **single-use and short-lived**, so a fresh one is minted on
every click and `refresh_url` points at a handler that mints another. Never
store one.

### 2. Status

Read live from the API on every page load, never cached:

```ts
const account = await stripeClient.v2.core.accounts.retrieve(accountId, {
  include: ["configuration.merchant", "requirements"],
});
```

`include` is required — omit it and the fields come back undefined, which reads
as "not ready" forever. Requirements change without this application doing
anything, so a stored "onboarded: true" goes stale silently and tells a
merchant they can take payments when they cannot.

Returning from onboarding is **not** proof of completion; the redirect can be
reached with requirements still outstanding. That is why the dashboard re-reads
rather than trusting the redirect.

### 3. Products

Created on the merchant's account via the `Stripe-Account` header — in
stripe-node, the second argument:

```ts
stripeClient.products.create(params, { stripeAccount: accountId })
```

Get this wrong and nothing errors: the product lands on the platform account
and the storefront is silently empty. The single most common Connect mistake.

### 4. Storefront and direct charges

`/store/acct_…` lists the merchant's products and sells them with a **direct
charge**: the charge is created on the merchant's account, they are merchant of
record, funds settle to their balance, and the platform takes
`application_fee_amount`.

> The URL uses the Stripe account id **only because it makes the sample
> obvious**. In production use your own identifier — a merchant-chosen slug or
> an opaque id — and look the account up server-side. The account id in a
> public URL leaks your Stripe topology and welds a shared link to an id you do
> not control. The comment at the top of `app/store/[accountId]/page.tsx` says
> where the lookup goes.

Prices are always re-read from Stripe server-side. The buy action takes no
amount, so a caller cannot name their own price.

### 5. Platform subscription

The opposite direction: the merchant pays **you**. With V2 accounts one id is
both the connected account and the customer, so there is no separate `cus_…`:

```ts
stripeClient.checkout.sessions.create({
  customer_account: accountId,   // acct_…
  mode: "subscription",
  line_items: [{ price: priceId, quantity: 1 }],
  // …and NO { stripeAccount } — this charge belongs to the platform
});
```

The billing portal uses the same `customer_account` key. If it errors about a
missing configuration, save one once at
`dashboard.stripe.com/test/settings/billing/portal`.

---

## Things that will bite you

- **`{ stripeAccount }` vs `customer_account`.** The first says "act as the
  merchant" (storefront sales). The second says "bill the merchant" (your
  subscription). Passing the wrong one sends money the wrong way.
- **Thin vs snapshot parsing.** `parseEventNotification` for V2/thin,
  `webhooks.constructEvent` for V1/snapshot. Not interchangeable. (Older docs
  call the first `parseThinEvent`; stripe-node v22 renamed it.)
- **Raw body for signatures.** Parse to JSON first and every verification
  fails.
- **`subscription.customer_account`, not `subscription.customer`,** for a V2
  account — the latter is not the `acct_…` you want.
- **Amounts are in the smallest currency unit.** $12.50 is `1250`. Sending
  `12.5` charges twelve cents.
- **Success pages are not proof of payment.** Fulfil from webhooks; async
  methods settle days later, and the URL can simply be visited.
- **Mode discipline.** A test-mode `acct_…` is meaningless to a live-mode key.
  The mapping table records `livemode` so a mix-up is legible rather than
  presenting as "account not found".

## Not included

Deliberately out of scope for a sample, and each one is real work before this
shape goes to production: refunds and disputes on connected accounts, payouts,
tax collection, multi-currency, idempotency keys on the write paths, retry and
replay handling on the webhooks (the production integration's
`lib/stripe/connect-payments.ts` is worth reading for what that takes), and
persisting subscription state for entitlement checks — every place that last
one belongs is marked with a `TODO(production)` in the snapshot webhook.
