"use client";

import { useActionState, useEffect, useState } from "react";
import { LAlert, LCard, lButtonClass } from "@/components/ledger";
import { LInput, LSelect } from "@/components/ledger/forms";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { formatDate } from "@/lib/format";
import {
  createVendorLink,
  revokeVendorLink,
  disableClientAutopay,
  type AutopayDisableState,
  type VendorLinkState,
} from "../vendor-actions";

/**
 * "The vendor page" — one persistent link that answers the two questions a
 * 135 operator's AP desk otherwise re-emails a pilot for: what's still
 * open, and (if a credential packet is out for this client) where's your
 * paperwork. Mirrors packet-panel.tsx's create/rotate/revoke shape (same
 * days-valid picker, same candidateToken/revokedToken reconciliation so a
 * revoke never fights a later create across a render) and share-panel.tsx's
 * viewed-indicator wording (a fact about the LINK, not a claim about a
 * person — mail scanners fetch pages too).
 */

export type ExistingVendorLink = {
  /** Null while revoked, expired, or never created. */
  token: string | null;
  expiresAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
};

const DAY_CHOICES = ["30", "60", "90", "180", "365"];

const initial: VendorLinkState = { error: null };
const autopayInitial: AutopayDisableState = { error: null };

export type ClientAutopayState = {
  /** "Visa •••• 4242" when enrolled, null otherwise. */
  methodLabel: string | null;
  /** Formatted consent date, server-side, or null. */
  consentedOn: string | null;
};

export default function VendorPanel({
  clientId,
  clientName,
  existing,
  existingLoadError = false,
  autopay,
  canDisableAutopay = false,
}: {
  clientId: string;
  clientName: string;
  existing: ExistingVendorLink | null;
  /** The client's autopay enrollment, read off pilot.clients by the page. */
  autopay?: ClientAutopayState;
  /** Owner-only — pilot.client_autopay_disable refuses everyone else. */
  canDisableAutopay?: boolean;
  /**
   * A failed client_vendor_links read degrades `existing` to `null` the
   * same way "no live link" would — hiding the live-link block from a
   * pilot whose vendor page IS out with this client, and risking a second
   * one being minted on top of it. Same U4 shape as PacketPanel's own
   * documentsLoadError/existingLoadError.
   */
  existingLoadError?: boolean;
}) {
  const [state, formAction, creating] = useActionState(createVendorLink, initial);
  const [revokeState, revokeAction, revoking] = useActionState(revokeVendorLink, initial);
  const [days, setDays] = useState("90");
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const pending = creating || revoking;

  // Same reconciliation as PacketPanel's `token` — see its own comment for
  // the full reasoning behind this exact shape: a fresh create wins over
  // the server's existing row, and a revoke only clears the specific token
  // it targeted, not whatever this render happens to be showing.
  const candidateToken = state.token ?? existing?.token ?? null;
  const token =
    candidateToken &&
    revokeState.revoked &&
    (revokeState.revokedToken ?? candidateToken) === candidateToken
      ? null
      : candidateToken;

  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const url = token && origin ? `${origin}/vendor/${token}` : null;

  // Viewed stamps belong to the ROW's token. A freshly minted token this
  // render (state.token) has no stamps yet — a rotation clears them
  // server-side — so they must only be shown when the token on screen is
  // the same one the last server read described.
  const viewedRowMatches = Boolean(
    token && existing && existing.token === token && !state.token
  );
  const lastViewed = viewedRowMatches ? existing!.lastViewedAt : null;
  const firstViewed = viewedRowMatches ? existing!.firstViewedAt : null;

  useEffect(() => {
    setCopied(false);
  }, [token]);

  return (
    <LCard>
      <h2 className="mb-1 text-h3 font-semibold">Vendor page for {clientName}</h2>
      <p className="mb-3 text-body-s text-ink-2">
        One link for their accounts-payable desk: open invoices, total
        outstanding, payment history, and their paperwork if you&rsquo;ve
        shared any. It expires on its own, and you can revoke it any time.
      </p>

      {existingLoadError && !token ? (
        <LAlert tone="crit" className="mb-3">
          Couldn&rsquo;t check whether a live vendor page already exists for{" "}
          {clientName}. This is not a statement that none is out. Reload
          before creating a new one.
        </LAlert>
      ) : null}

      {url ? (
        <div className="flex flex-col gap-2">
          <span className="text-body-s font-medium text-ink">
            {state.token ? "Here's the link. Send it to their AP desk." : "The live link"}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <LInput value={url} readOnly aria-label="Vendor page link" />
            <button
              type="button"
              className={lButtonClass({ variant: "outline" })}
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(
                  () => setCopied(true),
                  () => setCopied(false)
                );
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {existing?.expiresAt ? (
            <p className="text-caption text-ink-3">
              {`Stops working ${existing.expiresAt}. Replacing the link makes the old one dead immediately.`}
            </p>
          ) : null}
          {/* Same honest ceiling as share-panel.tsx: fetched while valid,
              not "your client read it". */}
          <p className="text-caption text-ink-3">
            {lastViewed
              ? `Viewed ${formatDate(lastViewed)}${
                  firstViewed && formatDate(firstViewed) !== formatDate(lastViewed)
                    ? ` · first opened ${formatDate(firstViewed)}`
                    : ""
                }. Opening counts even if it was an email scanner, not their AP desk.`
              : "Not viewed yet."}
          </p>

          <div className="mt-2 flex flex-wrap items-end gap-3">
            <form action={formAction}>
              <input type="hidden" name="client_id" value={clientId} />
              <input type="hidden" name="days_valid" value={days} />
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <span id="vendor-days-label" className="text-body-s font-medium text-ink">
                    New link works for
                  </span>
                  <LSelect
                    aria-labelledby="vendor-days-label"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                  >
                    {DAY_CHOICES.map((d) => (
                      <option key={d} value={d}>
                        {`${d} days`}
                      </option>
                    ))}
                  </LSelect>
                </div>
                <button type="submit" disabled={pending} className={lButtonClass({ variant: "outline" })}>
                  {creating ? "Replacing…" : "Replace the link"}
                </button>
              </div>
            </form>

            {/* CONFIRMED, same reasoning as PacketPanel's Revoke: this
                breaks a link a pilot may have already emailed to a client's
                AP desk, with no warning on their end that it's about to
                404. */}
            <button
              type="button"
              disabled={pending}
              className={lButtonClass({ variant: "quiet", className: "text-crit" })}
              onClick={() => setConfirmRevoke(true)}
            >
              {revoking ? "Revoking…" : "Revoke this link"}
            </button>
            <LConfirmDialog
              open={confirmRevoke}
              onOpenChange={setConfirmRevoke}
              title="Revoke this vendor page?"
              description="The link stops working immediately. If their AP desk has it bookmarked or in their email, it will 404 for them. Create a new one if they still need it."
              confirmLabel="Revoke"
              pending={revoking}
              onConfirm={() => {
                // Same field values a submitted <form action={revokeAction}>
                // would have posted — dispatched directly since the
                // confirm now lives in a dialog rather than wrapping its
                // own <form>. See packet-panel.tsx's identical shape.
                const formData = new FormData();
                formData.set("client_id", clientId);
                formData.set("revoking_token", token ?? "");
                revokeAction(formData);
                setConfirmRevoke(false);
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          {revokeState.revoked ? (
            <p className="text-caption text-ink-3">The previous link was revoked.</p>
          ) : null}
          <form action={formAction}>
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="days_valid" value={days} />
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <span id="vendor-days-label-new" className="text-body-s font-medium text-ink">
                  Link works for
                </span>
                <LSelect
                  aria-labelledby="vendor-days-label-new"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                >
                  {DAY_CHOICES.map((d) => (
                    <option key={d} value={d}>
                      {`${d} days`}
                    </option>
                  ))}
                </LSelect>
              </div>
              <button type="submit" disabled={pending} className={lButtonClass({ variant: "primary" })}>
                {creating ? "Creating…" : "Create the link"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* AUTOPAY — the client-side consent lives ON the vendor page this
          panel mints, so its status belongs beside the link. The pilot
          cannot enroll a client from here (consent is the client's own
          act, through their browser, on Stripe's hosted page); they can
          only see the state and turn it off. */}
      <div className="mt-4 border-t border-hair pt-4">
        <h3 className="mb-1 text-body font-semibold text-ink">Autopay</h3>
        {autopay?.methodLabel ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-body-s text-ink-2">
              {`${clientName} saved ${autopay.methodLabel}${
                autopay.consentedOn ? ` on ${autopay.consentedOn}` : ""
              }. Recurring schedules with autopay switched on charge it automatically when their invoice is created.`}
            </p>
            {canDisableAutopay ? <AutopayDisableButton clientId={clientId} /> : null}
          </div>
        ) : (
          <p className="text-body-s text-ink-2">
            Not set up. If they open the vendor page above, they can save a
            card there — recurring invoices are then charged automatically
            instead of waiting on a payment link.
          </p>
        )}
      </div>

      {state.error ? (
        <LAlert tone="crit" className="mt-3">
          {state.error}
        </LAlert>
      ) : null}
      {revokeState.error && (revokeState.revokedToken ?? token) === token ? (
        <LAlert tone="crit" className="mt-3">
          {revokeState.error}
        </LAlert>
      ) : null}
    </LCard>
  );
}

function AutopayDisableButton({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(disableClientAutopay, autopayInitial);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={lButtonClass({ variant: "quiet", className: "text-crit" })}
        onClick={() => setConfirmOpen(true)}
      >
        {pending ? "Turning off…" : "Turn autopay off"}
      </button>
      <LConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Turn autopay off for this client?"
        description="Their saved card is removed and nothing is charged automatically from then on — recurring invoices go back to payment links. They can set autopay up again from the vendor page any time."
        confirmLabel="Turn off"
        pending={pending}
        onConfirm={() => {
          const formData = new FormData();
          formData.set("client_id", clientId);
          action(formData);
          setConfirmOpen(false);
        }}
      />
      {state.error ? (
        <p className="text-caption text-crit" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
