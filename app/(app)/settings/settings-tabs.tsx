"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  LTabsContent,
  LTabsList,
  LTabsRoot,
  LTabsTrigger,
} from "@/components/ledger/tabs";

/**
 * The tab vocabulary, written once. It grew from three to six with Phase
 * 9's customisation layer, to seven with the profile/security surface, to
 * nine once categories earned its own tab, and to ten with the billing
 * surface, and a hand-written `a || b || c` predicate was exactly the
 * shape that goes stale each time — so the list IS the type and the type
 * guard reads from the list.
 *
 * Ten tabs is past Miller's 7±2 as a single flat row, so the strip below
 * clusters them under three small, non-interactive group labels —
 * "Business" (business, day-types, mileage, categories, billing),
 * "Communication" (messages, reminders) and "Appearance" (appearance,
 * layout); see TAB_GROUPS below. TAB_KEYS itself stays exactly this one
 * flat list of values: the grouping is a rendering concern in the JSX, not
 * a change to the type, the `?tab=` vocabulary, or the state machine —
 * still ONE LTabsRoot and ONE LTabsList, so Left/Right/Home/End and the
 * roving tabindex still walk all triggers in a single sequence. "profile"
 * stays outside all three groups; see the comment below for why.
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
  "billing",
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

/** Display text for each trigger, keyed once so the grouped tab row and
 *  the (label-free) panel row below never have to repeat it. */
const TAB_LABEL: Record<TabKey, string> = {
  business: "Your business",
  "day-types": "Day types",
  mileage: "Mileage",
  billing: "Billing",
  messages: "Message wording",
  reminders: "Reminders",
  appearance: "Appearance",
  layout: "Layout",
  categories: "Categories",
  profile: "Profile & security",
};

/**
 * The visual grouping for the tab STRIP only — see the header comment
 * above. Each group renders as a small `aria-hidden` label followed by
 * that group's triggers, all still inside the one LTabsList. "profile" is
 * deliberately absent from every group here: it renders last, on its own,
 * with no label before it.
 */
const TAB_GROUPS: { label: string; keys: TabKey[] }[] = [
  { label: "Business", keys: ["business", "day-types", "mileage", "categories", "billing"] },
  { label: "Communication", keys: ["messages", "reminders"] },
  { label: "Appearance", keys: ["appearance", "layout"] },
];

/**
 * LEDGER port of this file — components/ledger/tabs.tsx over
 * server-rendered panel content. Every panel is passed in already rendered
 * (data fetched server-side, same as LPageShell composing client children).
 *
 * Deep link: `initialTab` comes from page.tsx reading `?tab=` server-side,
 * seeding this component's initial state. Switching tabs updates the URL
 * via `history.pushState` — a plain browser call, not a Next navigation —
 * so it costs no RSC round trip, every tab stays bookmarkable,
 * reloadable, and linkable, and browser Back can step back through tab
 * switches instead of leaving the page entirely.
 *
 * Mounted panels: LTabsContent renders its children unconditionally
 * (`hidden` when inactive, never unmounted) so a mid-edit day-type row —
 * or a half-arranged nav layout — survives a glance at another tab. No
 * `forceMount`/`display:none` trick is needed here the way the old
 * Radix-based version needed one: LTabsContent already carries that
 * behavior itself.
 *
 * LTabsList/LTabsTrigger still give the roving tabindex and the
 * Left/Right/Home/End activation + `aria-controls` wiring the hand-rolled
 * version had to build by hand. The small group labels rendered between
 * clusters of triggers (see TAB_GROUPS) are plain `aria-hidden` text, not
 * `LTabsTrigger`s: they sit in the list's flex flow purely for visual
 * spacing and never join the roving-tabindex sequence LTabsTrigger reads
 * straight off the DOM, so keyboard users still land on all real tabs in
 * order.
 */
export default function SettingsTabs({
  business,
  dayTypes,
  mileage,
  billing,
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
  billing: ReactNode;
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

  const panels: { key: TabKey; content: ReactNode }[] = [
    { key: "business", content: business },
    { key: "day-types", content: dayTypes },
    { key: "mileage", content: mileage },
    { key: "billing", content: billing },
    { key: "messages", content: messages },
    { key: "reminders", content: reminders },
    { key: "appearance", content: appearance },
    { key: "layout", content: layout },
    { key: "categories", content: categories },
    { key: "profile", content: profile },
  ];

  return (
    <LTabsRoot value={tab} onValueChange={handleValueChange}>
      {/*
        THE ROW WRAPS RATHER THAN SCROLLING, and that is a reachability
        fix, not a style preference.

        LTabsList's own default is `overflow-x-auto` on a single row — fine
        at three tabs, not at ten: "Layout", "Categories" and "Profile &
        security" would sit past the right edge on a narrow phone with no
        scrollbar, no fade and no chevron, so a pilot looking for the
        password control would see four tabs, none of them about security,
        and would reasonably conclude the feature was not there (see the
        INSTRUMENT-era version of this component, which hit exactly that
        with Radix's own scroller).

        Wrapping keeps every tab visible and keyboard-reachable at every
        width. `overflowX: visible` goes with it so the now-unnecessary
        scroller cannot clip a wrapped row. The list's hairline ends up
        under the last row, where it still does its one job: separating
        the tabs from the panel below.
      */}
      <LTabsList
        aria-label="Settings sections"
        style={{ flexWrap: "wrap", overflowX: "visible" }}
      >
        {TAB_GROUPS.flatMap((group, index) => [
          <span
            key={`group-${group.label}`}
            aria-hidden
            // Not a tab, not focusable, not in the roving-tabindex sequence
            // LTabsTrigger builds (see the header comment) — a caption that
            // happens to sit inside the same flex row as the triggers.
            // `whitespace-nowrap` so a group name can never wrap into its
            // own row and overlap the wrapped trigger row below it; `ml-4`
            // before every group after the first is the only thing marking
            // a new cluster having started, since flex-wrap alone would
            // otherwise run every trigger into one visually even row.
            className={`whitespace-nowrap text-caption font-medium text-ink-3 ${
              index === 0 ? "" : "ml-4"
            }`}
          >
            {group.label}
          </span>,
          ...group.keys.map((key) => (
            <LTabsTrigger key={key} value={key}>
              {TAB_LABEL[key]}
            </LTabsTrigger>
          )),
        ])}
        <LTabsTrigger value="profile">{TAB_LABEL.profile}</LTabsTrigger>
      </LTabsList>

      <div className="pt-4">
        {panels.map((panel) => (
          <LTabsContent key={panel.key} value={panel.key}>
            {panel.content}
          </LTabsContent>
        ))}
      </div>
    </LTabsRoot>
  );
}
