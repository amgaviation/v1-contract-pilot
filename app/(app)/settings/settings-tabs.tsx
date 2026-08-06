"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import MDBox from "@/components/mdpro/MDBox";
import MDButton from "@/components/mdpro/MDButton";

type TabKey = "business" | "day-types";

const TABS: { key: TabKey; label: string }[] = [
  { key: "business", label: "Your business" },
  { key: "day-types", label: "Day types" },
];

function isTabKey(value: string | undefined): value is TabKey {
  return value === "business" || value === "day-types";
}

/**
 * Client-side tab switch over server-rendered panel content. Both panels
 * are passed in already rendered (data fetched server-side, same as
 * PageShell composing client children) and swapped with CSS display
 * rather than unmounted, so a pilot mid-edit on one tab doesn't lose
 * their draft by glancing at the other.
 *
 * F10: two fixes on top of the original client-state-only version.
 *
 *   1. Deep-linkable. `initialTab` comes from page.tsx reading `?tab=`
 *      server-side (Settings has no other server-rendered content that
 *      would make a client redirect necessary). Switching tabs updates
 *      the URL via `history.replaceState` — a plain browser call, not a
 *      Next navigation — so it costs no RSC round trip and the day-types
 *      tab can be bookmarked, reloaded into, or linked from elsewhere.
 *   2. Correct ARIA. `role="tab"` alone (no `aria-controls`, no roving
 *      `tabIndex`) left a screen reader with no way to associate a tab
 *      with its panel and left every tab in the Tab order at once. Now:
 *      each tab has `aria-controls` pointing at its panel's `id`, each
 *      panel has `aria-labelledby` pointing back, only the active tab is
 *      keyboard-tabbable (roving `tabIndex`), and Left/Right/Home/End move
 *      AND activate — the WAI-ARIA APG "automatic activation" tabs
 *      pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
 */
export default function SettingsTabs({
  business,
  dayTypes,
  initialTab,
}: {
  business: ReactNode;
  dayTypes: ReactNode;
  initialTab?: string;
}) {
  const [tab, setTab] = useState<TabKey>(isTabKey(initialTab) ? initialTab : "business");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function selectTab(key: TabKey) {
    setTab(key);
    const url = new URL(window.location.href);
    if (key === "business") url.searchParams.delete("tab");
    else url.searchParams.set("tab", key);
    window.history.replaceState(null, "", url);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = TABS[nextIndex];
    if (!next) return;
    selectTab(next.key);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <MDBox>
      <MDBox mb={3} display="flex" gap={1.5} flexWrap="wrap" role="tablist" aria-label="Settings sections">
        {TABS.map((option, index) => (
          <MDButton
            key={option.key}
            ref={(node: HTMLButtonElement | null) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            variant={tab === option.key ? "gradient" : "outlined"}
            color="info"
            role="tab"
            id={`settings-tab-${option.key}`}
            aria-selected={tab === option.key}
            aria-controls={`settings-panel-${option.key}`}
            tabIndex={tab === option.key ? 0 : -1}
            onClick={() => selectTab(option.key)}
            onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => handleKeyDown(event, index)}
          >
            {option.label}
          </MDButton>
        ))}
      </MDBox>

      <MDBox
        role="tabpanel"
        id="settings-panel-business"
        aria-labelledby="settings-tab-business"
        hidden={tab !== "business"}
        sx={{ display: tab === "business" ? "block" : "none" }}
      >
        {business}
      </MDBox>
      <MDBox
        role="tabpanel"
        id="settings-panel-day-types"
        aria-labelledby="settings-tab-day-types"
        hidden={tab !== "day-types"}
        sx={{ display: tab === "day-types" ? "block" : "none" }}
      >
        {dayTypes}
      </MDBox>
    </MDBox>
  );
}
