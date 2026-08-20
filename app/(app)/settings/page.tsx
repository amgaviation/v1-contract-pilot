import NextLink from "next/link";
import { LAlert, LCard } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { requireAccount } from "@/lib/supabase/account";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { centsToInput, formatDate } from "@/lib/format";
import SettingsForm, { type SettingsValues } from "./settings-form";
import InvoicingPanel, { type InvoicingValues } from "./invoicing-panel";
import ProfileDefaultsForm, {
  type ProfileDefaultsValues,
} from "./profile-defaults-form";
import LogoPanel from "./logo-panel";
import SettingsTabs from "./settings-tabs";
import DayTypesPanel from "./day-types-panel";
import BillingPanel from "./billing/billing-panel";
import ConnectPanel from "./connect-panel";
import PaymentMethodsPanel from "./payment-methods-panel";
import MileageRatesPanel from "./mileage-rates-panel";
import MessageTemplatesPanel from "./message-templates-panel";
import RemindersPanel from "./reminders-panel";
import AppearancePanel from "./appearance-panel";
import LayoutPanel from "./layout-panel";
import CategoriesPanel from "./categories-panel";
import ProfilePanel from "./profile-panel";
import AccountPanel from "./account-panel";
import { loadPreferences } from "@/lib/preferences";
import { loadCustomOptionsResult } from "@/lib/custom-options-read";
import { applyNavLayout, visibleNavSections } from "@/lib/nav";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";
import { readAchCapability } from "@/lib/stripe/connect";
import type { AchCapability } from "@/lib/stripe/payment-methods";
import { emailIsConfigured } from "@/lib/email/send";
import {
  describeSchedule,
  normalizeReminderPolicy,
  reminderPolicyIsEmpty,
} from "@/lib/reminders/policy";


type DayTypeRow = Database["pilot"]["Tables"]["day_types"]["Row"];
type MileageRateRow = Database["pilot"]["Tables"]["mileage_rates"]["Row"];
type AccountRow = Database["pilot"]["Tables"]["accounts"]["Row"];

/**
 * The onboarding-profile slice of the settings read (20260812400000
 * columns). Cast at the query boundary below, same reasoning as
 * lib/supabase/account.ts: recent supabase-js resolves this select
 * against the hand-authored types file to `never`, so the row type is
 * reasserted from the generated Row type — a mistyped column name here
 * is still a compile error against AccountRow.
 */
type ProfileDefaultsRow = Pick<
  AccountRow,
  | "dba_name"
  | "phone"
  | "home_base"
  | "certificate_type"
  | "certificate_number"
  | "ratings"
  | "default_day_rate_cents"
  | "default_travel_day_rate_cents"
  | "default_per_diem_cents"
  | "default_payment_terms_days"
>;

/**
 * How a membership role is named to the person holding it. The database
 * vocabulary (`owner` / `member` / `bookkeeper`) is not display copy, and
 * a bookkeeper reading "bookkeeper" in lower case next to their email
 * looks like a bug rather than a role.
 */
const ROLE_LABEL: Record<string, string> = {
  owner: "Account owner",
  member: "Member",
  bookkeeper: "Bookkeeper",
};

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  // F10: makes the day-types tab deep-linkable (/settings?tab=day-types)
  // — read server-side and handed to the client tab switch as its initial
  // state, rather than making the client fetch it itself.
  searchParams: Promise<{ tab?: string; warning?: string; connected?: string }>;
}) {
  const { tab, warning, connected } = await searchParams;

  // requireAccount's row has everything this page needs for its own
  // server-rendered text (logo_url, plan, status below), but it is also
  // the full `accounts` row — stripe_customer_id, stripe_subscription_id,
  // connect_account_id, plan, status, trial_ends_at included — and that
  // row must never be handed whole to a client component: passing it as
  // a prop puts all of it in the RSC flight payload sent to the browser,
  // regardless of what the prop's TYPE claims. So `values` below is its
  // own query, selecting only the columns SettingsValues declares, and
  // needs no cast because the query and the type finally agree.
  const { account, role, user } = await requireAccount("/settings");
  const canEdit = role === "owner";

  const supabase = await createClient();
  const { data: settingsValuesData, error: settingsValuesError } = await supabase
    .from("accounts")
    .select(
      // The onboarding-profile columns (20260812400000) ride the same
      // dedicated select rather than a second query: one read, one error
      // path, and the RSC-payload reasoning above holds for them too. One
      // literal string, not a concatenation — supabase-js derives the row
      // type from the literal, and `"a" + "b"` widens to plain `string`.
      "legal_name, address_line1, address_line2, city, state, postal_code, country, invoice_prefix, invoice_number_pad, invoice_number_include_year, default_tax_rate_bps, default_invoice_notes, invoice_footer, dba_name, phone, home_base, certificate_type, certificate_number, ratings, default_day_rate_cents, default_travel_day_rate_cents, default_per_diem_cents, default_payment_terms_days"
    )
    .eq("id", account.id)
    .maybeSingle();

  // A FAILED READ IS NOT AN EMPTY ACCOUNT. Discarding this error handed
  // SettingsForm `{}`, which is indistinguishable from a brand-new
  // account — every field rendered blank, and the first save wrote those
  // blanks over the legal name and address that print on every invoice
  // the pilot sends. The dayTypes and mileageRates blocks seventy lines
  // below already render a red "Couldn't load" card for exactly this; the
  // one holding the invoice address did not.
  const settingsValues: SettingsValues = settingsValuesData ?? {};
  const profileRow = settingsValuesData as ProfileDefaultsRow | null;
  // The Invoicing tab's six columns, off the SAME guarded read — so the
  // failed-read reasoning above covers them, and a read that failed cannot
  // render an empty form whose first save wipes the pilot's footer.
  const invoicingValues: InvoicingValues = (settingsValuesData ?? {}) as InvoicingValues;

  // THE CURRENT COUNT, for the numbering preview and the "Currently N"
  // hint. Its own read because it is a different table
  // (pilot.invoice_number_sequences) and because it is genuinely optional:
  // an error here degrades the preview to a count of 1 and says so, rather
  // than taking the whole tab down. `authenticated` has SELECT on the table
  // and RLS scopes it to this account.
  const { data: sequenceData } = await supabase
    .from("invoice_number_sequences")
    .select("next_number")
    .eq("account_id", account.id)
    .maybeSingle();
  const nextInvoiceCount =
    (sequenceData as { next_number: number } | null)?.next_number ?? null;

  // Same shape discipline as onboarding/page.tsx building OnboardingValues:
  // money through centsToInput (a raw cents integer would render a $1,200
  // day rate as "120000"), terms String()ed, everything else "" for null.
  // Built from the SAME guarded read as settingsValues, so the failed-read
  // card below covers this form too — blanks here would overwrite a stored
  // certificate and rate defaults on save.
  const profileValues: ProfileDefaultsValues = {
    dba_name: profileRow?.dba_name ?? "",
    phone: profileRow?.phone ?? "",
    home_base: profileRow?.home_base ?? "",
    certificate_type: profileRow?.certificate_type ?? "",
    certificate_number: profileRow?.certificate_number ?? "",
    ratings: profileRow?.ratings ?? "",
    default_day_rate: centsToInput(profileRow?.default_day_rate_cents),
    default_travel_day_rate: centsToInput(
      profileRow?.default_travel_day_rate_cents
    ),
    default_per_diem: centsToInput(profileRow?.default_per_diem_cents),
    default_payment_terms_days:
      profileRow?.default_payment_terms_days == null
        ? ""
        : String(profileRow.default_payment_terms_days),
  };

  // RLS scopes this to the caller's tenant; no account_id filter is
  // needed or wanted on a plain listing select (see the note in
  // clients/page.tsx). Ordered the same way the trip day grid orders its
  // picker, so the two stay visually in step.
  const { data: dayTypesData, error: dayTypesError } = await supabase
    .from("day_types")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true });

  const dayTypes = (dayTypesData ?? []) as DayTypeRow[];

  const { data: mileageRatesData, error: mileageRatesError } = await supabase
    .from("mileage_rates")
    .select("*")
    .order("tax_year", { ascending: false });

  const mileageRates = (mileageRatesData ?? []) as MileageRateRow[];

  // WHO THIS PRODUCT WILL WRITE TO ON THE PILOT'S BEHALF, listed by name.
  //
  // A per-client switch that only exists on each client's own page is a
  // switch nobody can audit: a pilot with fourteen clients would have to open
  // fourteen screens to answer "who am I chasing automatically?". This one
  // read answers it in one place.
  //
  // A FAILED READ IS NOT AN EMPTY LIST HERE — it would render as "none of
  // your 0 clients has a schedule, so nothing is sent automatically", which is
  // the most reassuring possible rendering of "we don't know" and a positive
  // claim this screen cannot vouch for while the scheduler keeps sending on
  // the real schedules. So the error is bound and handed to the panel, which
  // says it could not load rather than saying nobody is being chased — the
  // same fold the Overview page does with its own degraded reads.
  const { data: reminderClientData, error: reminderClientError } = await supabase
    .from("clients")
    .select("id, name, reminder_before_due, reminder_on_due, reminder_after_due")
    .is("archived_at", null)
    .order("name", { ascending: true });

  const reminderClientRows = (reminderClientData ?? []) as {
    id: string;
    name: string;
    reminder_before_due: number[] | null;
    reminder_on_due: boolean | null;
    reminder_after_due: number[] | null;
  }[];
  const clientsWithSchedules = reminderClientRows
    .map((row) => ({
      id: row.id,
      name: row.name,
      policy: normalizeReminderPolicy({
        beforeDue: row.reminder_before_due,
        onDue: row.reminder_on_due,
        afterDue: row.reminder_after_due,
      }),
    }))
    .filter((entry) => !reminderPolicyIsEmpty(entry.policy))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      summary: describeSchedule(entry.policy),
    }));

  // Phase 9 Layers 2 and 3. loadPreferences is total: it falls back to
  // the product's defaults for a missing or unreadable row, which is the
  // ordinary state until a pilot changes something.
  //
  // The taxonomy read is deliberately the RESULT variant, not the total
  // one the pickers use. A management screen must distinguish "you have
  // no categories" from "we couldn't read your categories" — the picker
  // fallback ([] and carry on) would have this panel print "Nothing here
  // yet… set up for every account automatically" over a failed read, with
  // no error anywhere on screen.
  //
  // The LAYOUT panel is offered every section this account has, in the
  // tenant's current ORDER but WITHOUT the hidden filter applied — the
  // hidden ones have to stay on screen, with their Show switch off, or a
  // pilot who hid a section could never get it back. So the layout here
  // is deliberately `{ order, hidden: [] }` rather than the whole thing;
  // the rail (app/(app)/layout.tsx) applies both halves.
  //
  // A flag-gated section that is currently off is not offered here at
  // all. Its stored HIDDEN state survives a save (the panel posts every
  // hidden href it holds, rendered or not); its stored place in the order
  // does not, and it returns at the end of the list when the engine is
  // switched on.
  const preferences = await loadPreferences(account.id);

  /**
   * WHETHER THE PILOT'S OWN STRIPE ACCOUNT MAY TAKE BANK PAYMENTS.
   *
   * One Stripe round trip on this render, and only when an account is
   * connected. It is deliberately NOT skipped when the stored preference is
   * card-only: the panel below lets the pilot switch to a bank option
   * client-side, and a control that offers ACH while the page holds no idea
   * whether ACH works would answer "we couldn't check" to a question it
   * simply never asked.
   *
   * readAchCapability never throws — a Stripe outage resolves to 'unknown',
   * the panel says so, and nothing else on this page is affected. A
   * settings screen must not go down because a capability lookup did.
   */
  const achCapability: AchCapability = account.connect_account_id
    ? await readAchCapability(account.connect_account_id)
    : "unknown";

  const { rows: customOptions, error: customOptionsError } =
    await loadCustomOptionsResult();
  const navSections = applyNavLayout(visibleNavSections(isCurrencyEngineEnabled()), {
    order: preferences.nav.order,
    hidden: [],
  });

  return (
    <LPageShell
      title="Settings"
      subtitle={`Signed in as ${user.email ?? "your account"}`}
    >
      <SettingsTabs
        initialTab={tab}
        // THE BUSINESS TAB IS IDENTITY ONLY — the name, address, defaults
        // and letterhead mark that print on documents. Money in (Stripe
        // Connect, payment methods, export) lives on the Payments tab and
        // money out (the subscription) on the Billing tab: the old single
        // tab carried three unrelated jobs, and the one a pilot visits
        // weekly (payments) was buried in a sidebar column of the one they
        // visit once (their own address).
        business={
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
              {settingsValuesError ? (
                <LAlert tone="crit" className="flex flex-col gap-1">
                  <p className="font-semibold">Couldn&rsquo;t load your business details</p>
                  <p className="text-body-s text-ink-2">
                    They&rsquo;re not shown because we couldn&rsquo;t read them,
                    not because they&rsquo;re empty. Don&rsquo;t save from this
                    screen until it loads, or you&rsquo;ll overwrite the name and
                    address that print on your invoices. Reload in a moment.
                  </p>
                </LAlert>
              ) : (
                <>
                  <SettingsForm values={settingsValues} canEdit={canEdit} />
                  <ProfileDefaultsForm values={profileValues} canEdit={canEdit} />
                </>
              )}
            </div>
            <div className="flex flex-col gap-4">
              <LogoPanel hasLogo={Boolean(account.logo_url)} canEdit={canEdit} />
            </div>
          </div>
        }
        // EVERYTHING THAT DECIDES WHAT AN INVOICE LOOKS LIKE, on its own
        // tab. invoice_prefix used to sit on the Business tab beside the
        // postal address, which is where it happened to be added rather
        // than where it belongs — it is one third of the number format,
        // and the other two thirds arrived with this panel.
        invoicing={
          settingsValuesError ? (
            <LAlert tone="crit" className="flex flex-col gap-1">
              <p className="font-semibold">Couldn&rsquo;t load your invoice settings</p>
              <p className="text-body-s text-ink-2">
                They&rsquo;re not shown because we couldn&rsquo;t read them, not
                because they&rsquo;re empty. Don&rsquo;t save from this screen
                until it loads. Reload in a moment.
              </p>
            </LAlert>
          ) : (
            <InvoicingPanel
              values={invoicingValues}
              nextNumber={nextInvoiceCount}
              canEdit={canEdit}
            />
          )
        }
        payments={
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <ConnectPanel
                configured={Boolean(process.env.STRIPE_CONNECT_CLIENT_ID)}
                canEdit={canEdit}
                connected={Boolean(account.connect_account_id)}
                warning={warning}
                justConnected={connected === "1"}
              />
              {/* Only with an account to mint links on. The choice is
                  meaningless otherwise, and a live control that changes
                  nothing is how a settings screen starts lying. */}
              {account.connect_account_id ? (
                <PaymentMethodsPanel
                  methods={preferences.payments.methods}
                  achCapability={achCapability}
                  canEdit={canEdit}
                />
              ) : null}
            </div>
            <div className="flex flex-col gap-4">
              {/* No Plan card here — the Billing tab, one trigger down in
                  the same group, IS the plan surface (current plan, change,
                  interval, receipts, portal). A summary card beside it
                  would be a second, staler statement of the same facts. */}
              <LCard>
                <div className="flex flex-col gap-2">
                  <h3 className="text-h3 font-semibold">Your data</h3>
                  <p className="text-body-s text-ink-2">
                    Download everything this product holds for you: clients,
                    trips, invoices, expenses, mileage and document details,
                    as CSV files.
                  </p>
                  <NextLink
                    href="/settings/export"
                    className="text-body-s font-medium text-accent hover:underline"
                  >
                    Export your data
                  </NextLink>
                </div>
              </LCard>
            </div>
          </div>
        }
        dayTypes={
          dayTypesError ? (
            <LAlert tone="crit">
              Couldn&rsquo;t load your day types. Try reloading the page.
            </LAlert>
          ) : (
            <DayTypesPanel dayTypes={dayTypes} canEdit={canEdit} />
          )
        }
        mileage={
          mileageRatesError ? (
            <LAlert tone="crit">
              Couldn&rsquo;t load your mileage rates. Try reloading the page.
            </LAlert>
          ) : (
            <MileageRatesPanel rates={mileageRates} canEdit={canEdit} />
          )
        }
        // No `changed`/`state` props: those are billing/actions.ts's own
        // redirect flags for the standalone `/settings/billing` route (see
        // billing-panel.tsx's header). Landing on this tab never carries
        // them, so the panel's confirmation banners simply stay quiet here
        // — the plan cards, current-plan card, receipts and portal button
        // below are otherwise byte-for-byte the same read.
        billing={<BillingPanel />}
        // loadPreferences is total, so `templates` is always a well-formed
        // pair — {null, null} for the ordinary account that has never opened
        // this tab, which the panel renders as two empty boxes showing the
        // built-in wording. There is no failed-read card here, and that is
        // the same call the appearance and layout panels make: a preferences
        // read that fails yields the product's own defaults, and defaults
        // are exactly what an unsaved template already means.
        messages={
          <MessageTemplatesPanel
            templates={preferences.templates}
            canEdit={canEdit}
          />
        }
        reminders={
          <RemindersPanel
            // Both switches are ENVIRONMENT facts, resolved on the server:
            // a client component must never see either variable, and the
            // panel only needs to know whether they are set.
            schedulerConfigured={Boolean(process.env.CRON_SECRET)}
            mailConfigured={emailIsConfigured()}
            lastRunAt={
              account.reminders_last_run_at
                ? formatDate(account.reminders_last_run_at)
                : null
            }
            clientsWithSchedules={clientsWithSchedules}
            clientsTotal={reminderClientRows.length}
            clientsLoadFailed={Boolean(reminderClientError)}
          />
        }
        appearance={<AppearancePanel slots={preferences.theme} canEdit={canEdit} />}
        layout={
          <LayoutPanel
            sections={navSections}
            layout={preferences.nav}
            canEdit={canEdit}
          />
        }
        categories={
          <CategoriesPanel
            options={customOptions}
            canEdit={canEdit}
            readError={customOptionsError}
          />
        }
        // SCALARS ONLY. requireAccount's `user` is the full Supabase User —
        // app_metadata, identities, and whatever a future provider hangs
        // off it — and handing it to a client component would put all of
        // that in the RSC flight payload whatever the prop type says. Same
        // reasoning as the `values` query at the top of this file. Dates go
        // through formatDate here rather than in the client component, so
        // the panel holds no date logic and the whole screen formats dates
        // one way.
        //
        // No canEdit prop, and that is not an omission: these controls act
        // on the SIGNED-IN PERSON, not on the account, so a member or
        // bookkeeper changes their own password exactly as an owner does.
        // See profile-actions.ts's header.
        profile={
          <ProfilePanel
            email={user.email ?? null}
            emailConfirmed={Boolean(user.email_confirmed_at)}
            pendingEmail={user.new_email ?? null}
            pendingEmailSentAt={
              user.email_change_sent_at ? formatDate(user.email_change_sent_at) : null
            }
            lastSignInAt={user.last_sign_in_at ? formatDate(user.last_sign_in_at) : null}
            memberSince={user.created_at ? formatDate(user.created_at) : null}
            roleLabel={ROLE_LABEL[role] ?? role}
            accountName={account.legal_name}
          />
        }
        account={
          <AccountPanel
            legalName={account.legal_name}
            isOwner={canEdit}
            holdEndsAt={
              account.hold_ends_at ? formatDate(account.hold_ends_at) : null
            }
          />
        }
      />
    </LPageShell>
  );
}
