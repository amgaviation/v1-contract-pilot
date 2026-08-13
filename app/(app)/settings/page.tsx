import NextLink from "next/link";
import { Card, Flex, Grid, Link as RadixLink, Text } from "@/components/ui";

import { requireAccount } from "@/lib/supabase/account";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { centsToInput, formatDate } from "@/lib/format";
import PageShell from "../page-shell";
import SettingsForm, { type SettingsValues } from "./settings-form";
import ProfileDefaultsForm, {
  type ProfileDefaultsValues,
} from "./profile-defaults-form";
import LogoPanel from "./logo-panel";
import SettingsTabs from "./settings-tabs";
import DayTypesPanel from "./day-types-panel";
import ConnectPanel from "./connect-panel";
import MileageRatesPanel from "./mileage-rates-panel";
import MessageTemplatesPanel from "./message-templates-panel";
import AppearancePanel from "./appearance-panel";
import LayoutPanel from "./layout-panel";
import CategoriesPanel from "./categories-panel";
import ProfilePanel from "./profile-panel";
import { loadPreferences } from "@/lib/preferences";
import { loadCustomOptionsResult } from "@/lib/custom-options-read";
import { applyNavLayout, visibleNavSections } from "@/lib/nav";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";

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
      "legal_name, address_line1, address_line2, city, state, postal_code, country, invoice_prefix, dba_name, phone, home_base, certificate_type, certificate_number, ratings, default_day_rate_cents, default_travel_day_rate_cents, default_per_diem_cents, default_payment_terms_days"
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
  const { rows: customOptions, error: customOptionsError } =
    await loadCustomOptionsResult();
  const navSections = applyNavLayout(visibleNavSections(isCurrencyEngineEnabled()), {
    order: preferences.nav.order,
    hidden: [],
  });

  return (
    <PageShell
      title="Settings"
      subtitle={`Signed in as ${user.email ?? "your account"}`}
    >
      <SettingsTabs
        initialTab={tab}
        business={
          <Grid columns={{ initial: "1", lg: "3" }} gap="4">
            <Flex direction="column" gap="4" gridColumn={{ md: "span 2" }}>
              {settingsValuesError ? (
                <Card>
                  <Flex direction="column" gap="1" p="1">
                    <Text weight="bold" color="red">
                      Couldn&rsquo;t load your business details
                    </Text>
                    <Text size="2" color="gray">
                      They&rsquo;re not shown because we couldn&rsquo;t read them —
                      not because they&rsquo;re empty. Don&rsquo;t save from this
                      screen until it loads, or you&rsquo;ll overwrite the name and
                      address that print on your invoices. Reload in a moment.
                    </Text>
                  </Flex>
                </Card>
              ) : (
                <>
                  <SettingsForm values={settingsValues} canEdit={canEdit} />
                  <ProfileDefaultsForm values={profileValues} canEdit={canEdit} />
                </>
              )}
            </Flex>
            <Flex direction="column" gap="4">
              <LogoPanel hasLogo={Boolean(account.logo_url)} canEdit={canEdit} />
              <Card>
                <Flex direction="column" gap="2" p="1">
                  <Text weight="bold" size="4">
                    Plan
                  </Text>
                  <Text size="2" color="gray">
                    {account.plan ?? "—"} · {account.status}
                  </Text>
                  {/* Read-only on purpose. Plan, seat count and every Stripe
                      column are withheld from the tenant UPDATE grant AND
                      blocked by the accounts_protect_billing_columns trigger,
                      so billing state changes only ever arrive through the
                      Stripe webhook. Showing an editable control here would
                      promise something the database refuses. */}
                  <Text size="1" color="gray">
                    Billing is managed through Stripe. Changes to your plan arrive here
                    automatically.
                  </Text>
                </Flex>
              </Card>
              <ConnectPanel
                canEdit={canEdit}
                connected={Boolean(account.connect_account_id)}
                warning={warning}
                justConnected={connected === "1"}
              />
              <Card>
                <Flex direction="column" gap="2" p="1">
                  <Text weight="bold" size="4">
                    Your data
                  </Text>
                  <Text size="2" color="gray">
                    Download everything this product holds for you — clients,
                    trips, invoices, expenses, mileage and document details —
                    as CSV files.
                  </Text>
                  <Text size="2">
                    <RadixLink asChild>
                      <NextLink href="/settings/export">Export your data</NextLink>
                    </RadixLink>
                  </Text>
                </Flex>
              </Card>
            </Flex>
          </Grid>
        }
        dayTypes={
          dayTypesError ? (
            <Card>
              <Text size="2" color="red">
                Couldn&rsquo;t load your day types. Try reloading the page.
              </Text>
            </Card>
          ) : (
            <DayTypesPanel dayTypes={dayTypes} canEdit={canEdit} />
          )
        }
        mileage={
          mileageRatesError ? (
            <Card>
              <Text size="2" color="red">
                Couldn&rsquo;t load your mileage rates. Try reloading the page.
              </Text>
            </Card>
          ) : (
            <MileageRatesPanel rates={mileageRates} canEdit={canEdit} />
          )
        }
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
      />
    </PageShell>
  );
}
