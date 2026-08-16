"use client";

import { useState } from "react";
import { LButton } from "@/components/ledger";
import { LConfirmDialog, LDialog } from "@/components/ledger/dialog";
import {
  LTabsContent,
  LTabsList,
  LTabsRoot,
  LTabsTrigger,
} from "@/components/ledger/tabs";

/**
 * The two Ledger primitives that genuinely need client state — LDialog
 * (open/onOpenChange) and LTabsRoot (value/onValueChange) — factored into
 * their own "use client" file for the same reason every real interactive
 * Ledger widget in the product is (trips/[id]/delete-trip-button.tsx,
 * settings/settings-tabs.tsx): seam-harness/page.tsx itself stays a plain
 * server component, and only the pieces that truly need hooks cross the
 * boundary.
 *
 * Prop shapes below are pulled from real call sites: DialogSpecimen mirrors
 * invoices/[id]/share-panel.tsx's LDialog-with-footer-buttons shape plus
 * trips/[id]/delete-trip-button.tsx's LConfirmDialog; TabsSpecimen mirrors
 * settings/settings-tabs.tsx's controlled LTabsRoot with three triggers.
 */

export function DialogSpecimen() {
  const [infoOpen, setInfoOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <div className="flex flex-wrap gap-3">
      <LButton type="button" variant="outline" onClick={() => setInfoOpen(true)}>
        Replace client link
      </LButton>
      <LDialog
        open={infoOpen}
        onOpenChange={setInfoOpen}
        title="Replace this client link?"
        description="The link you already sent stops working immediately. If your client has it bookmarked or in their inbox, it will 404 for them. You’ll get a new link to send instead."
        footer={
          <>
            <LButton type="button" variant="quiet" onClick={() => setInfoOpen(false)}>
              Keep the current link
            </LButton>
            <LButton type="button" onClick={() => setInfoOpen(false)}>
              Replace it
            </LButton>
          </>
        }
      />

      <LButton
        type="button"
        variant="outline"
        className="text-crit hover:text-crit"
        onClick={() => setConfirmOpen(true)}
      >
        Delete trip
      </LButton>
      <LConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this trip?"
        description="This deletes the trip, its legs, and its day grid. The billing record goes with it. This can’t be undone."
        confirmLabel="Delete trip"
        pending={pending}
        onConfirm={() => {
          setPending(true);
          setTimeout(() => {
            setPending(false);
            setConfirmOpen(false);
          }, 400);
        }}
      />
    </div>
  );
}

const TAB_KEYS = ["business", "day-types", "profile"] as const;
type TabKey = (typeof TAB_KEYS)[number];
const TAB_LABEL: Record<TabKey, string> = {
  business: "Your business",
  "day-types": "Day types",
  profile: "Profile & security",
};

export function TabsSpecimen() {
  const [tab, setTab] = useState<TabKey>("business");
  return (
    <LTabsRoot value={tab} onValueChange={(v) => setTab(v as TabKey)}>
      <LTabsList aria-label="Seam harness tabs">
        {TAB_KEYS.map((key) => (
          <LTabsTrigger key={key} value={key}>
            {TAB_LABEL[key]}
          </LTabsTrigger>
        ))}
      </LTabsList>
      <div className="pt-4">
        <LTabsContent value="business">
          <p className="text-body-s text-ink-2">
            Default day rate, payment terms, and invoice numbering.
          </p>
        </LTabsContent>
        <LTabsContent value="day-types">
          <p className="text-body-s text-ink-2">
            Billable and per-diem day types, each with its own default rate.
          </p>
        </LTabsContent>
        <LTabsContent value="profile">
          <p className="text-body-s text-ink-2">
            Email, password, and sign-out-everywhere-else.
          </p>
        </LTabsContent>
      </div>
    </LTabsRoot>
  );
}
