# Documents, Sharing & Crew

Seven tables: `documents` (a pilot's own paperwork — medicals, certificates, W-9s — with expiry tracking); `invoice_shares` (the token that lets a client open one invoice with no login); `document_shares` and `document_share_items` (the token, and the chosen contents, for a credential packet a pilot sends a client); `estimate_shares` (the token that lets a client view and accept/decline one quote); `client_vendor_links` (the token behind a standing per-client "what do I owe / where's your paperwork" page); `crew_members` (a per-account roster of pilots and crew a tenant has flown with or employs).

## documents

A pilot's own paperwork, kept on file: medical certificates, flight review sign-offs, passports, other certificates, insurance, W-9s, PIC proficiency checks, and anything that doesn't fit those (`other`). It exists so the app's expiration engine has one place to look for every date-bearing credential a tenant holds, instead of each document type inventing its own expiry column that a reminder sweep could miss. A row can belong to the account generally or be linked to a specific client (a client's own W-9, say) and, separately, to the specific airman it belongs to.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`. Identifies the document row.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts.id`. The tenant this document belongs to.

#### `kind`
`text`, not null. One of `medical`, `flight_review`, `passport`, `certificate`, `insurance`, `w9`, `pic_proficiency_check`, or `other`, enforced by a CHECK constraint (`documents_kind_check`). This vocabulary is meant to stay in lockstep with `app/(app)/documents/kinds.ts`; `pic_proficiency_check` was added later for 14 CFR 61.58 (a PIC proficiency check required for certain multi-crew or turbojet operations outside Parts 91K/121/125/133/135/137).

#### `label`
`text`, not null. The pilot-entered free-text name for the document (e.g. "Second-class medical", "Acme Corp COI").

#### `expires_on`
`date`, nullable, no default. When this document/credential expires. The column name is deliberately fixed — the app's expiration/reminder engine finds date-bearing rows by looking specifically for a column called `expires_on`, so renaming it would silently drop this table out of that ladder.

#### `issued_on`
`date`, nullable, no default. When the document was issued. A CHECK constraint requires `expires_on >= issued_on` whenever both are set, but neither is required to be present — an issue date does not imply an expiration, by design.

#### `client_id`
`uuid`, nullable. Foreign key (`account_id, client_id`) to `pilot.clients (account_id, id)`, cascading on delete. Set when this document belongs to (or was collected from) a specific client rather than being a general account-level record.

#### `file_path`
`text`, nullable. The Supabase Storage path to the underlying file, if one was uploaded. This table stores metadata and a pointer; it does not store file bytes itself.

#### `notes`
`text`, nullable. Free-text notes a pilot attaches to the document.

#### `created_at` / `updated_at`
Both `timestamptz`, not null, default `now()`. Standard bookkeeping timestamps; `updated_at` bumps whenever the row changes.

#### `completed_on`
`date`, nullable, no default, added after the base table. When a dated event — most importantly a 14 CFR 61.56 flight review — was actually completed, as distinct from `expires_on` (whatever the pilot separately typed as the expiry date). `lib/currency/flight-review.ts` uses this column to derive a flight review's 61.56 through-date with calendar-month arithmetic (no Part 135.301(a) grace period, since that provision doesn't apply here). No trigger derives `expires_on` from this column — the two stay independently pilot-entered on purpose.

#### `airman_user_id`
`uuid`, nullable. Foreign key to `auth.users.id`. Records *whose* flight review or medical this is, since 61.56 and 61.23(d) (like 61.57 currency) are per-airman duties, not per-account ones. NULL means unattributed — `lib/currency/read.ts` deliberately excludes a row without this set rather than guessing which pilot on the account it belongs to; NULL is never read as "the account has only one pilot."

### Notable constraints

- `documents_kind_check`: `kind` must be one of the eight listed values.
- `expires_on >= issued_on` whenever both are present.
- `expires_on >= completed_on` whenever both are present (`documents_completed_before_expires`).
- `unique (account_id, id)` — a composite-FK anchor letting other tables (`operator_qualifications`, `client_tax_forms`, `document_share_items`) reference a document scoped to its own tenant, so a cross-tenant attach fails at the constraint layer rather than relying on RLS alone.
- RLS is enabled.

### Changing this table

Standard tenant-scoped table — the general caveats in [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) apply. Keep any new `kind` value in sync with `app/(app)/documents/kinds.ts` and, if it's expiry-relevant, be aware the expiration engine keys off the literal `expires_on` column name.

## invoice_shares

One row per invoice that has ever been shared with a client. It holds the token that turns a plain URL (`app/invoice/[token]`) into the only way an unauthenticated client can see one invoice — no login exists for a pilot's clients, so this token *is* the access control, not a convenience layer in front of some other check.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts.id`.

#### `invoice_id`
`uuid`, not null. Foreign key (`account_id, invoice_id`) to `pilot.invoices (account_id, id)`, cascading on delete.

#### `token`
`text`, not null, unique. A 256-bit random value (32 bytes from Postgres's CSPRNG, `pgcrypto`'s `gen_random_bytes`) encoded base64url, checked by CHECK to be exactly 43 characters from `[A-Za-z0-9_-]`. It is deliberately *not* a UUID and *not* derived from the invoice id or any other visible identifier — a UUID reads as "an identifier," something people are trained to paste around, while this reads as a bearer credential. It is stored in plaintext rather than hashed: it's never compared against something a legitimate holder typed (unlike a password), it's never logged, and RLS already limits who can read it back.

#### `created_at`
`timestamptz`, not null, default `now()`.

#### `created_by`
`uuid`, nullable. Foreign key to `auth.users.id` — which pilot generated the link.

#### `revoked_at`
`timestamptz`, nullable. Set the moment a pilot kills the link; the row is kept (not deleted) so re-sharing can rotate the token instead of creating a duplicate live link.

#### `first_viewed_at` / `last_viewed_at`
Both `timestamptz`, nullable, and travel together — a CHECK constraint requires both to be null or both to be set, and `first_viewed_at <= last_viewed_at`. `last_viewed_at` updates on every subsequent fetch of a valid link, not just the first. They mean "this link was *fetched* while valid," not "a human read it" — mail scanners and link-preview bots trigger them too, so the UI says "Viewed" rather than claiming a person read it. The pilot's own account members previewing their own link are deliberately excluded from counting as a view.

### Notable constraints

- `unique (account_id, invoice_id)` — at most one *live* token per invoice; sharing again rotates the existing token (new value, `revoked_at` and the view timestamps cleared) rather than creating a second row.
- Token shape CHECK, and the `first_viewed_at`/`last_viewed_at` pairing CHECK described above.
- RLS is enabled; `authenticated` only has a SELECT policy scoped to the caller's own account — there is no INSERT/UPDATE/DELETE policy at all.

### Changing this table

This table is a security boundary: the `token` column alone decides whether a stranger with a URL can see a client's invoice. There is no direct INSERT/UPDATE grant to `authenticated` — every write goes through `pilot.invoice_share_create` (mint or rotate), `pilot.invoice_share_revoke` (kill a link), and `pilot.invoice_share_mark_viewed` (anon-callable view stamp), all `SECURITY DEFINER`. Editing a row by hand in the SQL Editor — reinstating a revoked token, backdating an expiry-adjacent timestamp, or copying a token elsewhere — bypasses those functions' membership and status checks entirely and can hand a client's invoice to whoever holds the edited value. Call the functions above instead of writing to the table directly. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) — the SQL Editor runs as an admin role and is not restricted by any of this.

## document_shares

One revocable, *expiring* link per client, serving a "credential packet" — a chosen set of the pilot's own documents (a W-9, a certificate of insurance, a signed agreement) bundled into a single link instead of emailed as attachments by hand, again and again. Unlike an invoice share, this one always expires: the documents it can point at (a passport, an insurance certificate) are standing personal data, not a record of one finished transaction, so a forgotten-but-still-live link is a bigger liability.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts.id`.

#### `client_id`
`uuid`, not null. Foreign key (`account_id, client_id`) to `pilot.clients (account_id, id)`, cascading on delete.

#### `token`
`text`, not null, unique. Same shape and same reasoning as `invoice_shares.token`: 32 random bytes, base64url, 43 characters, checked by CHECK.

#### `expires_at`
`timestamptz`, not null. Unlike an invoice share, this is required — a credential packet link is bounded to between 1 and 365 days from creation by the function that mints it, never open-ended.

#### `created_at`
`timestamptz`, not null, default `now()`.

#### `created_by`
`uuid`, nullable, foreign key to `auth.users.id`.

#### `revoked_at`
`timestamptz`, nullable. Set on manual revocation; the row survives so re-sharing rotates rather than duplicates.

### Notable constraints

- `unique (account_id, client_id)` — at most one live packet link per client; re-sharing rotates.
- Token shape CHECK.
- RLS is enabled; `authenticated` has SELECT only, scoped to the caller's account.

### Changing this table

This table is a security boundary in the same way `invoice_shares` is, guarding standing personal documents rather than one invoice. There is no direct INSERT/UPDATE grant to `authenticated`; writes go exclusively through `pilot.document_share_create` (mint/rotate, also replaces the row's contents in `document_share_items`), `pilot.document_share_revoke`, and the anon-facing read `pilot.document_packet_public` (metadata only — it never returns file bytes or a storage path). Do not hand-edit a token, an `expires_at`, or `revoked_at` here — that is a direct route to exposing a pilot's client's passport or insurance data to whoever gets the edited value. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

## document_share_items

The specific documents one credential packet (`document_shares`) actually includes. It exists so inclusion is explicit, one row per document: a client who asked for a W-9 must never also receive a passport just because both happened to be on file for the same pilot.

### Columns

#### `share_id`
`uuid`, not null, part of the composite primary key. Foreign key to `pilot.document_shares.id`, cascading on delete — deleting (or replacing) the parent share clears its items.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts.id`.

#### `document_id`
`uuid`, not null, part of the composite primary key. Foreign key (`account_id, document_id`) to `pilot.documents (account_id, id)`, cascading on delete.

### Notable constraints

- Primary key is `(share_id, document_id)` — a document can appear at most once per packet.
- The composite FK to `pilot.documents` is tenant-scoped by `account_id`, so a packet can never be made to point at another tenant's document.
- RLS is enabled; `authenticated` has SELECT only.

### Changing this table

Written exclusively by `pilot.document_share_create`, which deletes and reinserts a share's full item set on every mint/rotation (re-sharing replaces the contents wholesale, it doesn't merge). There is no direct INSERT/UPDATE grant to `authenticated`. A hand-inserted row here would add a document to a packet a client can already open with a live link, so treat any direct edit as security-sensitive, not just a data-integrity slip. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

## estimate_shares

One row per estimate ever shared, giving a client a token-guarded link (`app/estimate/[token]`) to view a quote and, uniquely among the share tables, actually respond to it — accept or decline — without ever creating an account.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts.id`.

#### `estimate_id`
`uuid`, not null. Foreign key (`account_id, estimate_id`) to `pilot.estimates (account_id, id)`, cascading on delete.

#### `token`
`text`, not null, unique. Same 32-byte, base64url, 43-character shape as every other share token in this schema, enforced by the same CHECK pattern.

#### `created_at`
`timestamptz`, not null, default `now()`.

#### `created_by`
`uuid`, nullable, foreign key to `auth.users.id`.

#### `revoked_at`
`timestamptz`, nullable.

#### `first_viewed_at` / `last_viewed_at`
Both `timestamptz`, nullable, paired the same way as `invoice_shares`' equivalents: "fetched while valid," not "read by a human," with `last_viewed_at` moving forward on every subsequent fetch rather than just the first — and the owning account's own members previewing their link don't count.

### Notable constraints

- `unique (account_id, estimate_id)` — one live token per estimate; re-sharing rotates.
- Token shape CHECK, and the view-timestamp pairing CHECK.
- RLS is enabled; `authenticated` has SELECT only, scoped to the caller's account.

### Changing this table

A security boundary, same as `invoice_shares`, with one extra stake: a live token here doesn't just expose data, it can flip an estimate's status. Writes go exclusively through `pilot.estimate_share_create` (mint/rotate), `pilot.estimate_share_revoke`, `pilot.estimate_share_mark_viewed`, `pilot.estimate_public_accept`, and `pilot.estimate_public_decline` — all `SECURITY DEFINER`, all re-deriving the estimate from the token itself (never a client-supplied id), and all requiring the estimate to currently be in `sent` status before accept/decline can act (a second, independent guard, `pilot.estimates_protect`, enforces the same legal-transition rule as a trigger regardless of which role performs the update). Never edit a row here by hand — a reinstated or copied token can let someone accept or decline a quote on the pilot's behalf. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

## client_vendor_links

One revocable, expiring link per client behind a standing "vendor page" (`app/vendor/[token]`): a read-only rollup of that client's open invoices, total outstanding, a condensed paid history, and — read-only, never minted from here — a pointer to that same client's live credential packet if one currently exists. It exists so a client's AP desk can check one persistent link instead of asking a pilot to re-send "what do we owe you" by email.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts.id`.

#### `client_id`
`uuid`, not null. Foreign key (`account_id, client_id`) to `pilot.clients (account_id, id)`, cascading on delete.

#### `token`
`text`, not null, unique. Same 32-byte, base64url, 43-character token shape as the rest of this schema's share tables.

#### `expires_at`
`timestamptz`, not null. Required, matching `document_shares` rather than `invoice_shares`: this link is a standing view onto financial and (transitively) personal-document data, not one closed transaction, so it gets the packet's bounded-lifetime discipline — 1 to 365 days from creation, enforced by the function that mints it.

#### `created_at`
`timestamptz`, not null, default `now()`.

#### `created_by`
`uuid`, nullable, foreign key to `auth.users.id`.

#### `revoked_at`
`timestamptz`, nullable.

#### `first_viewed_at` / `last_viewed_at`
Both `timestamptz`, nullable, same "fetched while valid" meaning as the other share tables — `last_viewed_at` updates on every subsequent view rather than only the first — excluding the owning account's own members.

### Notable constraints

- `unique (account_id, client_id)` — one live vendor-page link per client; re-sharing rotates.
- Token shape CHECK.
- RLS is enabled; `authenticated` has SELECT only, scoped to the caller's account.

### Changing this table

A security boundary: the token gates a client's own financial rollup and, indirectly, whether their credential packet link is surfaced. There is no direct INSERT/UPDATE grant to `authenticated`; writes go exclusively through `pilot.client_vendor_link_create` (mint/rotate), `pilot.client_vendor_link_revoke`, and `pilot.client_vendor_link_mark_viewed`, all `SECURITY DEFINER`. `pilot.client_vendor_page_public` is the only anon-facing read and enforces expiry and revocation itself. Never hand-edit a token, `expires_at`, or `revoked_at` — doing so can expose a client's outstanding balance or reinstate access to a page that was deliberately revoked. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

## crew_members

A per-account list of the pilots and crew a tenant has flown with or employs — name, role, contact info, certificates, free-text notes. It is deliberately just a record, not something the app reasons about: nothing here feeds duty/rest tracking, currency calculations, or scheduling, and no other feature computes off it today. A pilot types in who they've flown with, or a business owner types in who they employ, and it stays on file for reference.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts.id`.

#### `name`
`text`, not null. CHECK requires the trimmed value to be between 1 and 200 characters — not blank, not unbounded.

#### `role`
`text`, nullable. CHECK caps it at 100 characters when present (e.g. "SIC", "Dispatcher").

#### `email`
`text`, nullable. CHECK caps it at 320 characters (the practical email-address length ceiling) when present.

#### `phone`
`text`, nullable. CHECK caps it at 50 characters when present.

#### `certificates`
`text`, nullable, free text. CHECK caps it at 500 characters when present — a place to note certificate types/numbers, not a structured field.

#### `notes`
`text`, nullable, free text. CHECK caps it at 2000 characters when present.

#### `archived_at`
`timestamptz`, nullable. The only way a crew member stops showing up in the list — this table has no DELETE policy or grant at all. Crew records are archived, never deleted, on the same reasoning as `pilot.clients`: a crew record is history, and a hard delete today would silently break a future feature (trip-to-crew linkage) that doesn't exist yet but is already anticipated in the schema (see below).

#### `created_at` / `updated_at`
Both `timestamptz`, not null, default `now()`. `updated_at` is maintained by the same `pilot.set_updated_at()` trigger every `pilot.*` table uses, advancing automatically on any change rather than needing the app to set it.

### Notable constraints

- `unique (account_id, id)` — not used by anything yet. It's a forward-compatible composite-FK anchor: a future "who flew this trip" column would need to reference a crew row scoped to its own tenant, and adding the constraint now (before anything depends on it) avoids reshaping this table's key under live data later.
- RLS is enabled with SELECT/INSERT/UPDATE policies scoped to the caller's account; there is deliberately no DELETE policy, matching the archive-only design above.

### Changing this table

Standard tenant-scoped table — `authenticated` can INSERT and UPDATE the ordinary fields directly (never `account_id` or `id`, which are withheld from both grants so a tenant can't re-parent or rewrite a row's identity), and there's no delete path at all, by design. The general caveats in [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) apply; nothing here needs anything beyond them.
