import "server-only";
import { getSampleStripe, appOrigin } from "./client";

/**
 * ===========================================================================
 * SAMPLE CONNECT — creating, onboarding and inspecting V2 accounts
 * ===========================================================================
 *
 * Three things happen in this file, in the order a merchant experiences them:
 *
 *   1. CREATE   a V2 account for the merchant                (once)
 *   2. ONBOARD  them via a V2 Account Link                   (repeatable)
 *   3. INSPECT  what Stripe currently requires of them       (every page load)
 *
 * Step 3 is deliberately never cached in our database. Requirements change
 * without us doing anything — regulators, card networks and Stripe itself can
 * add them — so a stored "onboarded: true" goes stale silently and tells a
 * merchant they can take payments when they cannot. Always ask the API.
 */

/**
 * ---------------------------------------------------------------------------
 * 1. CREATE THE ACCOUNT
 * ---------------------------------------------------------------------------
 * The V2 accounts API. Note what is NOT here: there is no top-level
 * `type: 'express' | 'standard' | 'custom'`. That is the V1 model. V2 replaces
 * it with `configuration` (what the account can DO) plus `dashboard` (how much
 * Stripe-hosted UI it gets) plus `defaults.responsibilities` (who owns fees
 * and losses).
 *
 * The shape below is the documented starting point:
 *
 *   identity.country          where the business is established.
 *   dashboard: 'full'         the merchant gets a full Stripe Dashboard of
 *                             their own — closest to the old "Standard".
 *   responsibilities          `stripe` collects fees and absorbs losses,
 *                             which is what you want unless you are prepared
 *                             to underwrite your merchants yourself.
 *   configuration.customer    lets the account be billed BY YOU (this is what
 *                             makes `customer_account` work for the platform
 *                             subscription in checkout.ts — one id serves as
 *                             both the connected account and the customer).
 *   configuration.merchant    lets the account CHARGE its own customers.
 *                             `card_payments` must be requested explicitly.
 *
 * The full object: https://docs.stripe.com/api/v2/core/accounts/object
 */
export async function createSampleConnectedAccount(params: {
  displayName: string;
  contactEmail: string;
}): Promise<string> {
  const stripeClient = getSampleStripe();

  const account = await stripeClient.v2.core.accounts.create({
    display_name: params.displayName,
    contact_email: params.contactEmail,
    identity: {
      // Two-letter ISO country. Hard-coded to the US for the sample; a real
      // integration collects this from the merchant BEFORE creating the
      // account, because it cannot be changed afterwards.
      country: "us",
    },
    dashboard: "full",
    defaults: {
      responsibilities: {
        fees_collector: "stripe",
        losses_collector: "stripe",
      },
    },
    configuration: {
      // Present but empty: asking for the customer configuration with no
      // options is what enables `customer_account` billing later. Omit it and
      // the platform-subscription flow fails with a confusing error about the
      // account not being billable.
      customer: {},
      merchant: {
        capabilities: {
          card_payments: {
            requested: true,
          },
        },
      },
    },
  });

  return account.id;
}

/**
 * ---------------------------------------------------------------------------
 * 2. ONBOARD — the Account Link
 * ---------------------------------------------------------------------------
 * An Account Link is a SHORT-LIVED, SINGLE-USE url to Stripe's hosted
 * onboarding. Two consequences worth designing around:
 *
 *   - Never store one. Mint a fresh link every time the merchant clicks the
 *     button; a stored link will be expired by the time it is clicked.
 *   - `refresh_url` exists precisely because links expire. Stripe sends the
 *     merchant there when the link it was given is no longer usable, and your
 *     handler's job is to mint another and redirect. Ours is an app route that
 *     does exactly that (see app/sample-connect/refresh/route.ts).
 *
 * `configurations: ['merchant', 'customer']` must list the configurations you
 * actually created the account with — collecting requirements for a
 * configuration the account does not have is an error, and omitting one you DO
 * have means its requirements never get collected.
 */
export async function createSampleAccountLink(accountId: string): Promise<string> {
  const stripeClient = getSampleStripe();
  const origin = appOrigin();

  const accountLink = await stripeClient.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant", "customer"],
        // Where Stripe sends them when this link has expired — we mint a new
        // one and bounce them straight back into onboarding.
        refresh_url: `${origin}/sample-connect/refresh?accountId=${accountId}`,
        // Where Stripe sends them when they finish or abandon the flow.
        //
        // IMPORTANT: arriving here does NOT mean onboarding succeeded. Stripe
        // is explicit that the return url can be reached at any point,
        // including with requirements still outstanding. That is why the
        // dashboard re-reads the account from the API on load rather than
        // treating this redirect as proof of anything.
        return_url: `${origin}/sample-connect?accountId=${accountId}`,
      },
    },
  });

  return accountLink.url;
}

/**
 * ---------------------------------------------------------------------------
 * 3. INSPECT — what can this account actually do right now?
 * ---------------------------------------------------------------------------
 */
export type SampleAccountStatus = {
  accountId: string;
  displayName: string | null;
  /** Card payments are live: this merchant can be paid today. */
  readyToProcessPayments: boolean;
  /** Nothing is currently due or overdue. */
  onboardingComplete: boolean;
  /** Raw requirements status, for display: 'currently_due' | 'past_due' | … */
  requirementsStatus: string | null;
  /** Verbatim requirement entries, so the sample UI can list what is missing. */
  outstandingRequirements: string[];
};

/**
 * Reads live status straight from Stripe. Never cached, never stored — see
 * this file's header for why.
 *
 * `include` is required on V2 retrieves: the account object does not carry
 * `configuration` or `requirements` unless you ask for them, and reading a
 * field you did not include silently yields undefined, which here would read
 * as "not ready" forever.
 */
export async function getSampleAccountStatus(accountId: string): Promise<SampleAccountStatus> {
  const stripeClient = getSampleStripe();

  const account = await stripeClient.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.merchant", "requirements"],
  });

  // CAN THEY TAKE MONEY? The capability's own status is the authority — not
  // the absence of requirements, and not the fact that they finished the
  // hosted flow.
  const readyToProcessPayments =
    account?.configuration?.merchant?.capabilities?.card_payments?.status === "active";

  // WHAT DOES STRIPE STILL WANT? `minimum_deadline.status` summarises it.
  // 'currently_due' and 'past_due' both mean the merchant must act;
  // anything else (including no summary at all) means nothing is outstanding.
  const requirementsStatus = account.requirements?.summary?.minimum_deadline?.status ?? null;
  const onboardingComplete =
    requirementsStatus !== "currently_due" && requirementsStatus !== "past_due";

  // The individual entries, for a UI that tells the merchant WHAT is missing
  // rather than only that something is. Shapes vary by requirement type, so
  // this reads defensively and falls back to the raw code.
  const entries = account.requirements?.entries ?? [];
  const outstandingRequirements = entries
    .filter((entry) => {
      const awaited = (entry as { awaiting_action_from?: unknown }).awaiting_action_from;
      // Only requirements waiting on the MERCHANT are actionable in our UI;
      // ones awaiting Stripe's own review are not something they can fix.
      return !Array.isArray(awaited) || awaited.includes("account_holder");
    })
    .map((entry) => {
      const e = entry as { description?: string; requirement?: string };
      return e.description ?? e.requirement ?? "Additional information required";
    });

  return {
    accountId,
    displayName: account.display_name ?? null,
    readyToProcessPayments,
    onboardingComplete,
    requirementsStatus,
    outstandingRequirements,
  };
}
