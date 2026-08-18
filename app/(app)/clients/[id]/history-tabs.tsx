"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { LTabsContent, LTabsList, LTabsRoot, LTabsTrigger } from "@/components/ledger/tabs";

/**
 * The History panel's tab strip — the one piece of history-panel.tsx that
 * needs a client boundary. components/ledger/tabs.tsx's own header explains
 * why: there is no native tab control, so LTabsRoot is a hand-built
 * roving-tabindex widget and, being stateful, is "use client" — everything
 * ELSE about History (the four reads in history-queries.ts, every row, every
 * link) stays server-rendered.
 *
 * Each panel below arrives ALREADY RENDERED from history-panel.tsx (a
 * Server Component) as a plain ReactNode prop — this file only decides
 * which one is visible, the same split settings/settings-tabs.tsx uses for
 * its own (much larger) tab set. No `?tab=` deep link here: settings earns
 * one because its eleven sections are each worth bookmarking on their own;
 * History is one panel on a page a pilot already navigated to by client, so
 * local state is enough.
 */
const TAB_KEYS = ["trips", "invoices", "payments", "estimates"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_LABEL: Record<TabKey, string> = {
  trips: "Trips",
  invoices: "Invoices",
  payments: "Payments",
  estimates: "Estimates",
};

function isTabKey(value: string): value is TabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

export default function HistoryTabs({
  trips,
  invoices,
  payments,
  estimates,
}: {
  trips: ReactNode;
  invoices: ReactNode;
  payments: ReactNode;
  estimates: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("trips");
  const panels: Record<TabKey, ReactNode> = { trips, invoices, payments, estimates };

  return (
    <LTabsRoot value={tab} onValueChange={(value) => (isTabKey(value) ? setTab(value) : undefined)}>
      <LTabsList aria-label="Client history">
        {TAB_KEYS.map((key) => (
          <LTabsTrigger key={key} value={key}>
            {TAB_LABEL[key]}
          </LTabsTrigger>
        ))}
      </LTabsList>
      <div className="pt-4">
        {TAB_KEYS.map((key) => (
          <LTabsContent key={key} value={key}>
            {panels[key]}
          </LTabsContent>
        ))}
      </div>
    </LTabsRoot>
  );
}
