"use client";

import { useState } from "react";
import { Box, Tabs } from "@radix-ui/themes";
import type { ReactNode } from "react";

type TabKey = "business" | "day-types";

function isTabKey(value: string | undefined): value is TabKey {
  return value === "business" || value === "day-types";
}

/**
 * Radix `Tabs` over server-rendered panel content. Both panels are passed
 * in already rendered (data fetched server-side, same as PageShell
 * composing client children).
 *
 * Deep link: `initialTab` comes from page.tsx reading `?tab=` server-side,
 * seeding this component's initial state. Switching tabs updates the URL
 * via `history.pushState` — a plain browser call, not a Next navigation —
 * so it costs no RSC round trip, the day-types tab stays bookmarkable,
 * reloadable, and linkable, and browser Back can step back through tab
 * switches instead of leaving the page entirely.
 *
 * Mounted panels: `Tabs.Content` unmounts its inactive panel by default,
 * which would drop a mid-edit day-type row when a pilot glances at the
 * other tab. Both `Tabs.Content`s below use `forceMount` to stay mounted
 * always; `Tabs.Root` is kept controlled (rather than Radix's own
 * uncontrolled `defaultValue`) purely so this component knows which one
 * to hide, since `forceMount` also disables Radix's own
 * hidden-when-inactive behaviour.
 *
 * `Tabs.List`/`Tabs.Trigger` still give the roving tabindex and the
 * Left/Right/Home/End activation + `aria-controls` wiring that the
 * hand-rolled version had to build by hand.
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

  function handleValueChange(value: string) {
    if (!isTabKey(value)) return;
    setTab(value);
    const url = new URL(window.location.href);
    if (value === "business") url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.pushState(null, "", url);
  }

  return (
    <Tabs.Root value={tab} onValueChange={handleValueChange}>
      <Tabs.List aria-label="Settings sections">
        <Tabs.Trigger value="business">Your business</Tabs.Trigger>
        <Tabs.Trigger value="day-types">Day types</Tabs.Trigger>
      </Tabs.List>

      <Box pt="4">
        <Tabs.Content value="business" forceMount style={{ display: tab === "business" ? "block" : "none" }}>
          {business}
        </Tabs.Content>
        <Tabs.Content value="day-types" forceMount style={{ display: tab === "day-types" ? "block" : "none" }}>
          {dayTypes}
        </Tabs.Content>
      </Box>
    </Tabs.Root>
  );
}
