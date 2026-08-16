import { notFound } from "next/navigation";
import { LCard, LPill, LTable, LTd, LTh } from "@/components/ledger";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The CLIENT-FACING credential packet — the second unauthenticated route
 * in this product that exposes tenant data. Read
 * supabase/migrations/20260810100000_credential_packet_share.sql in full
 * before touching this file; pilot.document_packet_public is the entire
 * access boundary and this page is a thin renderer of what it returns.
 *
 * NO SESSION ASSUMED ANYWHERE HERE: no requireAccount, no account.ts
 * import, no auth.getUser(). The Supabase client binds to whatever cookies
 * exist and the only call made through it is the one RPC, which runs as
 * anon for a visitor and as authenticated for a pilot previewing their own
 * link — the identical SECURITY DEFINER function either way, so a preview
 * shows exactly what the client will see.
 *
 * WHAT IS DELIBERATELY NOT HERE: the files. The RPC returns metadata only
 * — kind, label, issue and expiry dates — and anon has no grant on
 * storage.objects. A client sees WHAT the pilot holds and WHEN it expires,
 * which is what "do you have current insurance" actually asks. Serving the
 * bytes needs its own signed-URL design and its own security review; do
 * not add it by reaching for the service-role client.
 *
 * FIELD BY FIELD, since this is tenant data leaving the tenant:
 *   business_name    The pilot's own legal name — already on every
 *                    invoice and every W-9 this client will receive.
 *   document_kind    "medical", "passport", "certificate" — the category,
 *                    not the number. No document identifier is exposed.
 *   document_label   Pilot-authored, and authored knowing it names a
 *                    document they intend to hand over.
 *   expires_on       The point of the packet: a client asking for a COI
 *                    is asking whether it is current.
 *   issued_on        Same, for the same reason.
 */

type PacketRow = {
  business_name: string;
  document_kind: string;
  document_label: string;
  expires_on: string | null;
  issued_on: string | null;
};

const KIND_LABEL: Record<string, string> = {
  medical: "Medical",
  flight_review: "Flight review",
  passport: "Passport",
  certificate: "Certificate",
  other: "Other",
};

export default async function PacketPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("document_packet_public", {
    p_token: token,
  } as never);

  const rows = (data ?? []) as PacketRow[];
  // A revoked link, an expired one, a wrong one and a database error all
  // land here as the same 404. That is deliberate: distinguishing them
  // tells a stranger holding a guessed token which guesses were closer.
  if (error || rows.length === 0) notFound();

  const businessName = rows[0]!.business_name;
  const today = new Date().toISOString().slice(0, 10);

  return (
    // Ledger's softer marketing variant, hand-painted — same posture as
    // app/invoice/[token]/page.tsx's own root (this page previously had no
    // explicit canvas ground of its own; it gets one now, matching every
    // sibling portal in this migration).
    <div className="min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <Logo />
        </div>

        <LCard className="mb-6 p-6 sm:p-8">
          <h1 className="mb-1 text-h3 font-bold text-ink">{businessName}</h1>
          <p className="mb-6 text-lead text-ink-2">
            Current paperwork, shared with you directly. Ask for a copy of
            anything you need on file.
          </p>

          <LTable>
            <thead>
              <tr>
                <LTh>Document</LTh>
                <LTh>Type</LTh>
                <LTh>Issued</LTh>
                <LTh>Expires</LTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                // An expired certificate of insurance is the single fact a
                // client most needs to see, so it is not rendered as an
                // ordinary date.
                const expired = row.expires_on !== null && row.expires_on < today;
                return (
                  <tr key={`${row.document_label}-${index}`}>
                    {/* scope="row": the row-header semantics the old
                        Table.RowHeaderCell carried — a screen reader
                        announces the other cells against this label. */}
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                    >
                      {row.document_label}
                    </th>
                    <LTd>
                      <span className="text-ink-2">
                        {KIND_LABEL[row.document_kind] ?? row.document_kind}
                      </span>
                    </LTd>
                    <LTd>
                      <span className="text-ink-2">
                        {row.issued_on ? formatDate(row.issued_on) : "—"}
                      </span>
                    </LTd>
                    <LTd>
                      {row.expires_on ? (
                        expired ? (
                          <LPill tone="crit">{`Expired ${formatDate(row.expires_on)}`}</LPill>
                        ) : (
                          formatDate(row.expires_on)
                        )
                      ) : (
                        <span className="text-ink-2">—</span>
                      )}
                    </LTd>
                  </tr>
                );
              })}
            </tbody>
          </LTable>
        </LCard>

        <p className="text-caption text-ink-3">
          This link was shared by {businessName} and stops working on its own.
          If you need it again, ask them to send a new one.
        </p>
      </div>
    </div>
  );
}
