"use client";

import { useState } from "react";
import { Box, Tabs } from "@/components/ui";
import type { ReactNode } from "react";

/**
 * The tab vocabulary, written once. It grew from three to six with Phase
 * 9's customisation layer, and to seven with the profile/security surface,
 * and a hand-written `a || b || c` predicate was exactly the shape that
 * goes stale each time — so the list IS the type and the type guard reads
 * from the list.
 *
 * "profile" sits LAST rather than first, deliberately: this screen's
 * subject is the business, and the one tab about the human signing in is
 * the exception at the end of the row, not the headline. It is also the
 * one tab whose contents are not account-wide — see profile-panel.tsx.
 */
const TAB_KEYS = [
  "business",
  "day-types",
  "mileage",
  "messages",
  "reminders",
  "appearance",
  "layout",
  "categories",
  "profile",
] as const;

type TabKey = (typeof TAB_KEYS)[number];

const DEFAULT_TAB: TabKey = "business";

function isTabKey(value: string | undefined): value is TabKey {
  return (TAB_KEYS as readonly string[]).includes(value ?? "");
}

/**
 * Radix `Tabs` over server-rendered panel content. Every panel is passed
 * in already rendered (data fetched server-side, same as PageShell
 * composing client children).
 *
 * Deep link: `initialTab` comes from page.tsx reading `?tab=` server-side,
 * seeding this component's initial state. Switching tabs updates the URL
 * via `history.pushState` — a plain browser call, not a Next navigation —
 * so it costs no RSC round trip, every tab stays bookmarkable,
 * reloadable, and linkable, and browser Back can step back through tab
 * switches instead of leaving the page entirely.
 *
 * Mounted panels: `Tabs.Content` unmounts its inactive panel by default,
 * which would drop a mid-edit day-type row — or a half-arranged nav
 * layout — when a pilot glances at another tab. Every `Tabs.Content`
 * below uses `forceMount` to stay mounted always; `Tabs.Root` is kept
 * controlled (rather than Radix's own uncontrolled `defaultValue`) purely
 * so this component knows which one to hide, since `forceMount` also
 * disables Radix's own hidden-when-inactive behaviour.
 *
 * `Tabs.List`/`Tabs.Trigger` still give the roving tabindex and the
 * Left/Right/Home/End activation + `aria-controls` wiring that the
 * hand-rolled version had to build by hand.
 */
export default function SettingsTabs({
  business,
  dayTypes,
  mileage,
  messages,
  reminders,
  appearance,
  layout,
  categories,
  profile,
  initialTab,
}: {
  business: ReactNode;
  dayTypes: ReactNode;
  mileage: ReactNode;
  messages: ReactNode;
  reminders: ReactNode;
  appearance: ReactNode;
  layout: ReactNode;
  categories: ReactNode;
  profile: ReactNode;
  initialTab?: string;
}) {
  const [tab, setTab] = useState<TabKey>(
    isTabKey(initialTab) ? initialTab : DEFAULT_TAB
  );

  function handleValueChange(value: string) {
    if (!isTabKey(value)) return;
    setTab(value);
    const url = new URL(window.location.href);
    if (value === DEFAULT_TAB) url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.pushState(null, "", url);
  }

  const panels: { key: TabKey; label: string; content: ReactNode }[] = [
    { key: "business", label: "Your business", content: business },
    { key: "day-types", label: "Day types", content: dayTypes },
    { key: "mileage", label: "Mileage", content: mileage },
    { key: "messages", label: "Message wording", content: messages },
    { key: "reminders", label: "Reminders", content: reminders },
    { key: "appearance", label: "Appearance", content: appearance },
    { key: "layout", label: "Layout", content: layout },
    { key: "categories", label: "Categories", content: categories },
    { key: "profile", label: "Profile & security", content: profile },
  ];

  return (
    <Tabs.Root value={tab} onValueChange={handleValueChange}>
      {/*
        THE ROW WRAPS RATHER THAN SCROLLING, and that is a reachability
        fix, not a style preference.

        Radix's `.rt-BaseTabList` is `overflow-x: auto; white-space:
        nowrap` with `scrollbar-width: none` AND
        `::-webkit-scrollbar { display: none }` — a scroller whose only
        affordance is deliberately removed. That was invisible at three
        tabs because the row fit. At seven it does not: the labels come to
        roughly 660px at the product's pinned scaling="90%", against about
        360px of usable width on a 390px phone. "Layout", "Categories" and
        "Profile & security" sat entirely past the right edge with no
        scrollbar, no fade and no chevron — so a pilot on a ramp looking
        for the password control saw four tabs, none of them about
        security, and would reasonably conclude the feature was not there.

        Wrapping keeps every tab visible and keyboard-reachable at every
        width, for one property. `overflowX: visible` goes with it so the
        now-unnecessary scroller cannot clip a wrapped row. The list's
        hairline ends up under the last row, where it still does its one
        job: separating the tabs from the panel below. Neither value is a
        visual one — layout keywords, not colours, radii or type.
      */}
      <Tabs.List
        aria-label="Settings sections"
        style={{ flexWrap: "wrap", overflowX: "visible" }}
      >
        {panels.map((panel) => (
          <Tabs.Trigger key={panel.key} value={panel.key}>
            {panel.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <Box pt="4">
        {panels.map((panel) => (
          <Tabs.Content
            key={panel.key}
            value={panel.key}
            forceMount
            style={{ display: tab === panel.key ? "block" : "none" }}
          >
            {panel.content}
          </Tabs.Content>
        ))}
      </Box>
    </Tabs.Root>
  );
}
