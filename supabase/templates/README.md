# Auth email templates

Branded HTML for the emails Supabase Auth sends to **pilots** (V1's own
users): signup confirmation, password reset, and email change. These are
pasted into the Supabase Dashboard — they are not read from this repo at
runtime; this directory is the source of truth so an edit is reviewed
here first and pasted second.

**The client-facing invoice/estimate/reminder emails are deliberately NOT
here and must never get this treatment.** Those go from the pilot to the
pilot's client, in the pilot's name, and carry no V1 or AMG branding at
all — lib/brand.ts and lib/email/invoice-message.ts state the rule. This
directory is only for mail where V1 itself is the sender and the pilot is
the reader.

## Installing

Supabase Dashboard → **Authentication → Email Templates**, then for each:

| Template in the dashboard | File | Subject line |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `Confirm your email — V1` |
| Reset password | `reset-password.html` | `Reset your V1 password` |
| Change email address | `change-email.html` | `Confirm your new email — V1` |

Paste the file's full contents into the template body (source mode), set
the subject, save. Takes effect on the next email sent — no deploy.

## The link shape is load-bearing

Every button href is:

```
{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=<flow>
```

not the default `{{ .ConfirmationURL }}`. Two reasons, both already
documented in docs/SETUP.md §0:

1. `{{ .ConfirmationURL }}` points at Supabase's hosted `/verify`
   endpoint, where the single-use token is spent by the first GET — which
   corporate mail scanners issue within seconds of delivery. The link
   must point at this app's own `/auth/confirm`, which only spends the
   token on a real click (POST).
2. `{{ .RedirectTo }}` is the exact `emailRedirectTo` the app passed
   (`…/auth/confirm?next=…`), so it already carries the right `next` for
   each flow and already contains a `?` — hence the `&` joins. Every
   sender in this codebase always passes one, and the URL must be on the
   project's redirect allowlist (Authentication → URL Configuration).

`type` must match the flow (`signup`, `recovery`, `email_change`) or
verifyOtp refuses the token.

## Design constraints, so an edit doesn't quietly break delivery

- Tables + fully inline styles only. No `<style>` block (Gmail clips),
  no external CSS, no webfonts.
- The logo is the hosted PNG (`/brand/navy.png`) with alt text "V1" —
  SVG is blocked by most clients.
- Single-column, 560px card, Arial stack. Colors mirror the app's Ledger
  palette (paper `#f2f1ec`, ink `#16213a`, accent `#23409c`).
- Keep the plain-text fallback link block: a client with the button's
  styling stripped still has a working URL.
