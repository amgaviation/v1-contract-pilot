# Setup — email and online payments

Written 2026-08-14. Two things in this product need outside accounts before
they work: **Resend** (sending invoices and chasing them) and **Stripe
Connect** (letting a pilot take card and bank payments from their own
clients). Everything else in `.env.example` is either already set or
explained where it sits.

Both are off by default and fail closed. An unset variable never degrades into
a half-working state: the email option is hidden and the pilot is told to
download the PDF, and the Connect panel says online payments are not switched
on. Nothing is silently broken while looking fine.

**The money question, answered once.** There are two Stripe integrations here
and they never touch:

| | What it is | Whose money |
|---|---|---|
| **Platform billing** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_*` | Pilots paying **you** for V1 subscriptions |
| **Connect** | `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_WEBHOOK_SECRET` | Clients paying **the pilot** for flying |

A pilot's client's money never enters your Stripe balance. Charges are
created *as the connected account* (`Stripe-Account` header) with no
`application_fee_amount`, no `on_behalf_of`, and no `transfer_data` — Stripe
calls this a **direct charge**, and it means the pilot is the merchant of
record and the funds settle into their own balance. See the header of
`lib/stripe/connect.ts` for the full argument and the Stripe doc references.

Your platform Stripe account plays two roles that are easy to confuse: it is
the account that **bills pilots**, and it is the **Connect platform** pilots
link themselves to. That second role moves no money. It is an identity and
authorization relationship, not a financial one.

---

## 0. Supabase Auth — stop confirmation/reset links from dying on arrival

**Symptom:** a signup confirmation link (or its resend, or a password-reset
link) fails immediately — often within seconds of being sent — with "that
link has expired," no matter how fast the pilot clicks it.

**Cause:** by default, Supabase's "Confirm signup" (and other auth) email
templates build the link from `{{ .ConfirmationURL }}`, which points
straight at `https://<project>.supabase.co/auth/v1/verify?token=...`. That
token is single-use, and it gets spent — silently, before the pilot ever
sees the email — the moment anything issues a plain GET against it. That
"anything" is routine: corporate mail security scanners and some email
clients' own "safe links" prefetchers fetch every URL in an inbound email to
check it for malware, seconds after it arrives. The pilot's own click is
then the *second* use of an already-spent token, and Supabase reports it the
same way it reports a genuinely expired one. Confirmed against this
project's own Supabase auth logs: repeated `403 "Email link is invalid or
has expired"` responses on `/verify`, seconds after the confirmation mail
was sent, well before a human could plausibly have clicked it. Supabase's
own troubleshooting doc names this exact failure: "OTP Verification
Failures: 'token has expired' or 'otp_expired' errors" → "The root cause:
Email prefetching."

`app/auth/confirm/route.ts` already does its half of the fix: it no longer
verifies a token on GET (the request a prefetcher makes). GET only renders a
page asking for one real click; only the POST that click sends actually
spends the token. But that only protects a link that already points at
**this app's own** `/auth/confirm` route — a link still built from
`{{ .ConfirmationURL }}` points at Supabase's hosted `/verify` endpoint
instead, and is spent there, before this app is ever reached. The
companion step below is what makes the fix reach the actual email:

1. In the Supabase dashboard, go to **Authentication → Email Templates**.
2. For **Confirm signup** (and, if used, **Magic Link**), replace the link
   in the template body — wherever it currently reads
   `{{ .ConfirmationURL }}` — with one built from `{{ .RedirectTo }}` (the
   exact `emailRedirectTo` this app already passes — e.g.
   `https://v1.amgaviationgroup.com/auth/confirm?next=%2Fwelcome`, from
   `signup/actions.ts`) plus `{{ .TokenHash }}`:

   ```
   {{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup
   ```

   (`type=magiclink` for the Magic Link template, if that one is in use.)
   `{{ .RedirectTo }}` — not `{{ .SiteURL }}` — is what carries this app's
   own `?next=...`, so this one substitution is what keeps a pilot landing
   wherever `next` said (`/welcome` after signup, `/settings` after an
   email change) instead of falling back to the project's bare Site URL.
3. **Reset Password** needs the same substitution if it still uses
   `{{ .ConfirmationURL }}` — check it the same way, with `type=recovery`.
4. Save. No code change or redeploy is needed — the templates take effect
   on the next email sent.

---

## 1. Resend — sending invoices by email

Two variables. Both must be set before the product offers "Email it to
&lt;client&gt;" anywhere; with either missing the option is hidden entirely,
because an invoice marked Sent that was never sent is the one outcome this
product refuses to produce (`lib/email/send.ts` exists for that reason).

```
RESEND_API_KEY=
INVOICE_FROM_EMAIL=
```

### Steps

1. **Create a Resend account** at [resend.com](https://resend.com). The free
   tier is enough to test with.

2. **Add and verify your sending domain** — [resend.com/domains](https://resend.com/domains)
   → *Add Domain*. Enter the domain you will send from (e.g. `yourdomain.com`,
   not the full email address).

   Resend gives you DNS records — a DKIM `TXT`, an SPF `TXT`, and usually a
   `MX` for the return path. Add them at your DNS host and press *Verify*.
   Propagation is usually minutes; it can be longer.

   **This step is not optional and is the single most common cause of failure.**
   An unverified domain makes every send fail with a 403 "domain is not
   verified". The product surfaces Resend's own message verbatim so you see
   that sentence rather than a generic failure.

   If the domain you verify is also the one Supabase Auth sends from, this
   same verification is what makes signup confirmation emails work. An
   unverified domain breaks signup and invoice delivery together, and neither
   is a code problem.

   **This deployment:** the domain is `mail.amgaviationgroup.com` and the
   sender is `v1-support@mail.amgaviationgroup.com`. Set it in two places or
   only half the mail flows — `INVOICE_FROM_EMAIL` (Vercel env, read by
   `lib/email/send.ts`) for product mail, and the Supabase dashboard under
   Auth → SMTP settings for the signup confirmation and password recovery.
   Nothing in this repo configures the second one.

3. **Create an API key** — [resend.com/api-keys](https://resend.com/api-keys)
   → *Create API Key*. Sending permission is all it needs. Copy it once; Resend
   does not show it again.

4. **Set both variables** in the Vercel project (Settings → Environment
   Variables), for every environment you want mail from:

   ```
   RESEND_API_KEY=re_xxxxxxxxxxxx
   INVOICE_FROM_EMAIL=billing@yourdomain.com
   ```

   `INVOICE_FROM_EMAIL` must be **on the domain you verified in step 2**. The
   mailbox does not need to exist to send, but make it one you can receive at:
   it is where a client's bounce goes.

   For local development put the same two lines in `.env.local`.

5. **Redeploy.** Environment variables are read at request time, but a running
   deployment does not pick up new ones until it restarts.

6. **Verify it works.** Open any sent invoice — the send option should now
   appear. Send one to yourself. On success the invoice records the send; on
   failure you get Resend's own reason, not a shrug.

### Notes worth knowing

- **Replies do not come to you.** Every invoice email sets `reply_to` to the
  signed-in pilot's own address, so a client hitting Reply reaches their pilot
  and not the software vendor. `INVOICE_FROM_EMAIL` is one deployment-wide
  sender shared by every tenant, which is exactly why the reply-to matters.
- **No `resend` npm package.** The integration is one authenticated POST
  (`lib/email/send.ts`). Nothing to install.
- **A timeout is reported as unknown, not as failure.** Resend has no
  idempotency key on this endpoint, so a request that was accepted but whose
  response timed out is reported honestly as "may or may not have been sent"
  rather than inviting a retry that would send a client a second copy.

### Scheduled reminders also need a third variable

The nightly chase run (`vercel.json`'s cron → `/api/reminders/run`) needs
Resend **and** its own secret:

```
CRON_SECRET=
```

Generate one with `openssl rand -base64 32` and set it in Vercel. Vercel
injects the same value into its own cron requests as
`Authorization: Bearer <secret>`. With it unset the route returns 503 and does
nothing — no read, no send, no row — so the cron entry is inert on any
deployment that has not set it, including previews. Settings → Reminders tells
you whether the daily run is actually switched on.

---

## 2. Stripe Connect — pilots taking payment from their own clients

This is already built end to end: OAuth onboarding, payment links on invoices,
card and ACH, automatic payment recording, and disconnect. It needs
configuration, not development.

Two variables:

```
STRIPE_CONNECT_CLIENT_ID=
STRIPE_CONNECT_WEBHOOK_SECRET=
```

### Steps

1. **Enable Connect on your platform Stripe account** —
   [dashboard.stripe.com/connect/accounts/overview](https://dashboard.stripe.com/connect/accounts/overview).
   Choose **Standard** accounts. Standard is what this integration implements
   and it is the right choice here: the pilot owns the Stripe account outright,
   handles their own onboarding and compliance, and keeps their own dashboard.
   Express and Custom use a different onboarding API that does not apply.

2. **Copy the Connect client ID** — [dashboard.stripe.com/settings/connect](https://dashboard.stripe.com/settings/connect).
   It looks like `ca_xxxxxxxx`. There is a separate one per mode; take it from
   the same mode as your `STRIPE_SECRET_KEY`.

   ```
   STRIPE_CONNECT_CLIENT_ID=ca_xxxxxxxx
   ```

3. **Register the OAuth redirect URI**, on that same settings page, under
   *Redirects*:

   ```
   https://<your-domain>/api/stripe/connect/callback
   ```

   It must match **exactly**, in each mode you use. Add your localhost variant
   too if you will test locally. A mismatch fails the hop at Stripe with an
   error the pilot cannot act on.

4. **Add the connected-accounts webhook** —
   [dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks), in
   the same mode as your secret key:

   - **URL:** `https://<your-domain>/api/stripe/connect-webhook`
   - **Listen to:** *events on connected accounts* — **not** the default,
     "events on your account". A direct charge on a pilot's own account is
     delivered on the connected-accounts scope only; registered the other way
     this endpoint receives nothing it can act on.
   - **Subscribe to exactly these five:**
     ```
     checkout.session.completed
     checkout.session.async_payment_succeeded
     checkout.session.async_payment_failed
     payment_intent.succeeded
     account.application.deauthorized
     ```
     `payment_intent.succeeded` is how an autopay charge (a recurring
     invoice charged to a client's saved card) is recorded — the webhook
     ignores every payment intent that isn't one of this product's own
     autopay charges.
     The first three each earn their place because ACH settles
     asynchronously: `completed` fires at mandate acceptance while the money
     has *not* moved, and one of the other two follows days later. Register
     only the first and no ACH payment is ever recorded; only the first two
     and a failed debit is invisible while the invoice still shows "bank
     payment initiated" for money that is never coming. The fourth lets the
     product notice a pilot revoking access from their own dashboard and
     unwind the connection cleanly.

     **Do not** subscribe to `charge.refunded` or `charge.dispute.*`. Money
     going back out is deliberately never recorded automatically — a pilot who
     refunds a client in their own dashboard corrects the payment on the
     invoice themselves. Extra subscriptions only fill the delivery ledger with
     ignored rows.

   Then copy **that endpoint's** signing secret:

   ```
   STRIPE_CONNECT_WEBHOOK_SECRET=whsec_xxxxxxxx
   ```

   **This is not `STRIPE_WEBHOOK_SECRET`.** Stripe mints a distinct `whsec_`
   per endpoint and the platform's secret cannot verify a Connect delivery.
   Two endpoints, two secrets.

5. **Redeploy**, then check Settings → Business. The panel should offer
   *Connect with Stripe*. Before step 2 it says online payments are not
   switched on for this deployment, which is how you can tell the variable did
   not land.

### What the pilot experiences

Settings → Business → **Connect with Stripe** → Stripe's own OAuth screen,
where they sign into an existing Stripe account or create one → back to
Settings, connected. From then on any sent invoice offers a payment link, and a
client paying it settles into the pilot's own Stripe balance. Payments record
themselves onto the invoice when the webhook confirms the money actually moved.

Only an account **owner** can connect or disconnect. Disconnecting stops new
links; links already sent keep working on the pilot's own account until they
deactivate them in their dashboard, and the panel says so before confirming.

### Leaving `STRIPE_CONNECT_WEBHOOK_SECRET` empty

Onboarding still works and links still generate; the route refuses every
delivery with a 503 before touching Stripe or the database, and pilots record
payments by hand exactly as they did before the feature existed. That is a
legitimate way to launch Connect a week before the webhook, and nothing lies
about it.

---

## Mode discipline (both integrations)

Keep every Stripe value in the **same mode** — test keys with test price ids,
test Connect client id, test webhook secrets. The webhooks refuse any event
whose `livemode` disagrees with the key's mode, and the Connect OAuth exchange
refuses a grant whose mode disagrees, so a test event can never mutate live
data. Those guards hold only if you do not mix values from both modes in one
deployment.

Going live means swapping all of them together, and re-registering both
webhook endpoints and the OAuth redirect URI in live mode — Stripe does not
carry any of that across from test.
