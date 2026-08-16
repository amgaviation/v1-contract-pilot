"use client";

import { useActionState, useEffect, useState } from "react";
import { LAlert, LCard, lButtonClass } from "@/components/ledger";
import { LCheckbox, LInput, LSelect } from "@/components/ledger/forms";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { createPacketShare, revokePacketShare, type PacketState } from "../packet-actions";

/**
 * "Send this client your paperwork" — the packet a pilot otherwise
 * re-attaches to an email for every new client, and again every time
 * something expires.
 *
 * The pilot ticks what goes in. That is the whole point of the design:
 * the link means "these documents", not "my wallet". A client who asked
 * for a W-9 must not receive a passport because it was on the same
 * screen.
 */

export type PacketDocument = {
  id: string;
  kind: string;
  label: string;
  expiresOn: string | null;
};

export type ExistingPacket = {
  /** Null while revoked or never created. */
  token: string | null;
  expiresAt: string | null;
  documentCount: number;
};

const DAY_CHOICES = ["7", "14", "30", "60", "90"];

const initial: PacketState = { error: null };

export default function PacketPanel({
  clientId,
  clientName,
  documents,
  documentsLoadError = false,
  existing,
  existingLoadError = false,
}: {
  clientId: string;
  clientName: string;
  documents: PacketDocument[];
  /**
   * U4: a failed documents read degrades `documents` to `[]` the same way
   * genuinely having none would — telling a pilot with a W-9, certificate
   * of insurance and day-rate agreement all on file "Nothing to send yet"
   * and hiding the create-link form is a defect, not a graceful fallback.
   */
  documentsLoadError?: boolean;
  existing: ExistingPacket | null;
  /**
   * Same shape as documentsLoadError, on the read next to it: a failed
   * document_shares lookup degrades `existing` to `null` the same way
   * "no live packet" would, hiding the live-link block below from a pilot
   * whose credential packet IS out with this client — risking a second
   * one being created on top of it.
   */
  existingLoadError?: boolean;
}) {
  const [state, formAction, creating] = useActionState(createPacketShare, initial);
  const [revokeState, revokeAction, revoking] = useActionState(revokePacketShare, initial);
  const [days, setDays] = useState("30");
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const pending = creating || revoking;

  // The freshest token this render should show: a freshly minted one from
  // THIS create beats whatever the server already had, so the pilot sees
  // the new link immediately without waiting on revalidatePath's
  // re-render (same reasoning as SharePanel's `liveToken`).
  const candidateToken = state.token ?? existing?.token ?? null;

  // A revoke nulls OUT the specific token it targeted, not "whatever
  // token this panel is showing right now". revokeState.revokedToken is
  // echoed back by revokePacketShare from the hidden `revoking_token`
  // input, i.e. it names the exact token that revoke dispatch tried to
  // kill. Scoping the check to that identity — rather than a bare
  // `revokeState.revoked` latch — is what lets it self-clear: once a
  // LATER create mints a different token, candidateToken no longer
  // equals revokedToken and this branch is simply moot, so the new link
  // renders normally without anything having to reset revokeState. A
  // bare latch cannot do that — it stays true for the rest of the mount,
  // so create A, revoke A, create B would render NO link for B while the
  // panel simultaneously said "the previous link was revoked" under a
  // "Replace the link" button: three contradictory statements about the
  // same packet on one render.
  // `revokedToken ?? candidateToken` rather than a bare `revokedToken`
  // comparison: if a dispatch ever came back without a token to name (the
  // hidden `revoking_token` field missing or empty), this must not read as
  // "doesn't match, so show the link" — it fails toward hiding a possibly
  // revoked link, not toward showing one.
  const token =
    candidateToken &&
    revokeState.revoked &&
    (revokeState.revokedToken ?? candidateToken) === candidateToken
      ? null
      : candidateToken;
  const url = token
    ? `${typeof window === "undefined" ? "" : window.location.origin}/packet/${token}`
    : null;

  // Copied is per-link: it must not survive a token change and claim a
  // different link is on the clipboard than the one actually copied.
  useEffect(() => {
    setCopied(false);
  }, [token]);

  return (
    <LCard>
      <h2 className="mb-1 text-h3 font-semibold">Paperwork for {clientName}</h2>
      <p className="mb-3 text-body-s text-ink-2">
        One link with the documents this client asked for. It expires on its
        own, and you can revoke it at any time.
      </p>

      {documentsLoadError ? (
        <LAlert tone="crit">
          Couldn&rsquo;t load this client&rsquo;s documents, so nothing is
          offered below. This is not a statement that none are on
          file. Reload before assuming there&rsquo;s nothing to send.
        </LAlert>
      ) : documents.length === 0 ? (
        <p className="text-body-s text-ink-2">
          Nothing to send yet. Add a W-9, a certificate of insurance or your
          day-rate agreement under Documents first.
        </p>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="days_valid" value={days} />

          <div className="mb-3 flex flex-col gap-2">
            {documents.map((doc) => (
              <label key={doc.id} className="flex items-center gap-2 text-body-s text-ink">
                <LCheckbox name={`doc:${doc.id}`} />
                {doc.label}
                <span className="text-caption text-ink-3">
                  {doc.expiresOn ? `expires ${doc.expiresOn}` : doc.kind}
                </span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span id="packet-days-label" className="text-body-s font-medium text-ink">
                Link works for
              </span>
              <LSelect aria-labelledby="packet-days-label" value={days} onChange={(e) => setDays(e.target.value)}>
                {DAY_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {`${d} days`}
                  </option>
                ))}
              </LSelect>
            </div>
            <button type="submit" disabled={pending} className={lButtonClass({ variant: "primary" })}>
              {creating ? "Creating…" : token ? "Replace the link" : "Create the link"}
            </button>
          </div>

          {state.error ? (
            <LAlert tone="crit" className="mt-3">
              {state.error}
            </LAlert>
          ) : null}
        </form>
      )}

      {/* Gated on `!url`, which is itself already derived from the
          revokedToken match above — so this only shows once the token it
          is talking about has actually been cleared off screen, not for
          the whole remaining lifetime of the mount. */}
      {!url && revokeState.revoked ? (
        <p className="mt-2 text-caption text-ink-3">The previous link was revoked.</p>
      ) : null}

      {/* Also gated on `!url`: a freshly created token this render (state.
          token) is the current truth regardless of whether the earlier
          server-side lookup failed, so this must not cover that case. */}
      {existingLoadError && !url ? (
        <LAlert tone="crit" className="mt-2">
          Couldn&rsquo;t check whether a live link already exists for{" "}
          {clientName}. This is not a statement that none is out.
          Reload before creating a new one.
        </LAlert>
      ) : null}

      {url ? (
        <div className="mt-4 flex flex-col gap-2">
          <span className="text-body-s font-medium text-ink">
            {state.token ? "Here's the link. Send it to them." : "The live link"}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <LInput value={url} readOnly aria-label="Packet link" />
            <button
              type="button"
              className={lButtonClass({ variant: "outline" })}
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(
                  () => setCopied(true),
                  // A clipboard permission refusal is not an error worth a
                  // banner — the field beside it is selectable.
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
          {/* CONFIRMED, same reasoning as SharePanel's Revoke: clicking this
              breaks a link the pilot may already have emailed, and the
              client's browser tab gives no warning that it is about to
              404. An unconfirmed one-click revoke on a passport/insurance
              link is the wrong shape. */}
          <div>
            <button
              type="button"
              disabled={pending}
              className={lButtonClass({ variant: "quiet", size: "sm", className: "text-crit" })}
              onClick={() => setConfirmRevoke(true)}
            >
              {revoking ? "Revoking…" : "Revoke this link"}
            </button>
          </div>
          <LConfirmDialog
            open={confirmRevoke}
            onOpenChange={setConfirmRevoke}
            title="Revoke this client link?"
            description="The link stops working immediately. If your client has it bookmarked or in their email, it will 404 for them. Create a new one if they still need these documents."
            confirmLabel="Revoke"
            pending={revoking}
            onConfirm={() => {
              // Same field values a submitted <form action={revokeAction}>
              // would have posted (client_id, revoking_token) — dispatched
              // directly since the confirm now lives in a dialog rather
              // than wrapping its own <form>. Echoes back exactly the
              // token this render is showing, so revokePacketShare's
              // returned revokedToken can be compared against a later
              // render's own token — see the `token` derivation above and
              // packet-actions.ts's comment on it.
              const formData = new FormData();
              formData.set("client_id", clientId);
              formData.set("revoking_token", token ?? "");
              revokeAction(formData);
              setConfirmRevoke(false);
            }}
          />
          {/* Scoped to the token this failed revoke was actually about, the
              same way the success path is scoped above — otherwise a
              revoke that failed on an old token would keep showing this
              error underneath a brand new link a subsequent create just
              made live, which is not a failure of anything on screen
              anymore. `revokedToken ?? token`, not a bare comparison: an
              error path that returns without echoing revoking_token (the
              client_id check in revokePacketShare, before revokingToken
              is even read) must not read as "doesn't match, so drop the
              error" — the same fail-closed reasoning as the `token`
              derivation above. */}
          {revokeState.error && (revokeState.revokedToken ?? token) === token ? (
            <LAlert tone="crit">{revokeState.error}</LAlert>
          ) : null}
        </div>
      ) : null}
    </LCard>
  );
}
