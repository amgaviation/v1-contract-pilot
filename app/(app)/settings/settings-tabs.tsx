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
 * ten with the billing surface, and to eleven when "Payments" was split
 * out of "Your business" — a hand-written `a || b || c` predicate was
 * exactly the shape that goes stale each time, so the list IS the type
 * and the type guard reads from the list.
 *
 * ELEVEN SECTIONS IS A SIDEBAR, NOT A ROW. At this count a single
 * horizontal strip is past Miller's 7±2 whichever way it wraps, and the
 * previous design — inline group captions floating between wrapped pills —
 * let a caption end one visual row while its own tabs started the next,
 * so the grouping it existed to show was illegible exactly when it was
 * needed. The layout is now responsive: at lg+ the SAME tablist renders
 * as a vertical grouped sidebar (headers above each cluster, the pattern
 * every settings surface this size uses), and below lg it renders as a
 * plain wrapped row with the captions hidden — eleven legible pills beat
 * eleven pills interleaved with four orphanable labels on a phone.
 *
 * Still ONE LTabsRoot and ONE LTabsList either way, so the `?tab=`
 * vocabulary, the state machine, and the roving tabindex are unchanged —
 * LTabsTrigger reads activation order straight off the DOM, and its key
 * map covers both axes (Left/Right and Up/Down), so the keyboard works in
 * both orientations without an orientation prop.
 *
 * "profile" sits LAST and outside every group, deliberately: this
 * screen's subject is the business, and the one tab about the human
 * signing in is the exception at the end, not the headline. It is also
 * the one tab whose contents are not account-wide — see profile-panel.tsx.
 */
const TAB_KEYS = [
  "business",
  "payments",
  "billing",
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

/** Display text for each trigger, keyed once. */
const TAB_LABEL: Record<TabKey, string> = {
  business: "Your business",
  payments: "Payments",
  billing: "Billing",
  "day-types": "Day types",
  mileage: "Mileage",
  messages: "Message wording",
  reminders: "Reminders",
  appearance: "Appearance",
  layout: "Layout",
  categories: "Categories",
  profile: "Profile & security",
};

/**
 * The grouping, by what the pilot is trying to do rather than by which
 * panel implements it:
 *
 *   Business             who you are, money in (Payments — how clients
 *                        pay you) and money out (Billing — what you pay
 *                        for this product, plus your data)
 *   Rates & categories   the vocabulary trips and expenses are priced in
 *   Communication        what this product says in your name, and when
 *   Workspace            how the app itself looks and is arranged
 *
 * "profile" is deliberately absent from every group: it renders last, on
 * its own — see the header comment.
 */
const TAB_GROUPS: { label: string; keys: TabKey[] }[] = [
  { label: "Business", keys: ["business", "payments", "billing"] },
  { label: "Rates & categories", keys: ["day-types", "mileage", "categories"] },
  { label: "Communication", keys: ["messages", "reminders"] },
  { label: "Workspace", keys: ["appearance", "layout"] },
];

/**
 * LEDGER tabs over server-rendered panel content — every panel is passed
 * in already rendered, and LTabsContent keeps every panel MOUNTED
 * (`hidden`, never unmounted) so a mid-edit day-type row or half-arranged
 * nav layout survives a glance at another tab.
 *
 * Deep link: `initialTab` comes from page.tsx reading `?tab=` server-side.
 * Switching tabs updates the URL via `history.pushState` — a plain browser
 * call, not a Next navigation — so it costs no RSC round trip and every
 * tab stays bookmarkable and linkable.
 *
 * THE RESPONSIVE SPLIT, spelled out because it is all utility classes on
 * the same three nodes:
 *
 *   - LTabsRoot gets `lg:grid lg:grid-cols-[12rem_1fr]`: sidebar + panel
 *     at lg, ordinary stacked flow below.
 *   - LTabsList keeps its mobile shape (wrapped row, hairline underneath)
 *     and at lg becomes a sticky vertical column with the hairline off —
 *     the sidebar's own left rule on each trigger replaces it.
 *   - Each LTabsTrigger keeps its underline style in the row and swaps to
 *     a left-rule style at lg (`lg:border-b-0 lg:border-l-2`): the
 *     primitive's selected state colors `border-accent`, which paints
 *     whichever border edge currently has width, so the selected style
 *     follows the orientation with no change to the primitive.
 *   - Group captions are `hidden lg:block`: headers above their cluster in
 *     the sidebar, absent from the wrapped row. They are `aria-hidden`
 *     plain text either way — never triggers, never in the tab sequence.
 */
export default function SettingsTabs({
  business,
  payments,
  billing,
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
  payments: ReactNode;
  billing: ReactNode;
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

  const panels: { key: TabKey; content: ReactNode }[] = [
    { key: "business", content: business },
    { key: "payments", content: payments },
    { key: "billing", content: billing },
    { key: "day-types", content: dayTypes },
    { key: "mileage", content: mileage },
    { key: "messages", content: messages },
    { key: "reminders", content: reminders },
    { key: "appearance", content: appearance },
    { key: "layout", content: layout },
    { key: "categories", content: categories },
    { key: "profile", content: profile },
  ];

  const triggerClass =
    "lg:mb-0 lg:w-full lg:border-b-0 lg:border-l-2 lg:px-3 lg:py-1.5 lg:text-left";

  return (
    <LTabsRoot
      value={tab}
      onValueChange={handleValueChange}
      className="lg:grid lg:grid-cols-[12rem_1fr] lg:items-start lg:gap-8"
    >
      {/* Below lg the row WRAPS rather than scrolling — a reachability
          fix, not a style preference: a scrolled row hides "Profile &
          security" past the right edge of a phone with no scrollbar, no
          fade and no chevron, and a pilot looking for the password
          control reasonably concludes the feature is not there. The
          style prop wins over the list's own overflow-x-auto. */}
      <LTabsList
        aria-label="Settings sections"
        className="lg:sticky lg:top-16 lg:flex-col lg:items-stretch lg:gap-0.5 lg:border-b-0"
        style={{ flexWrap: "wrap", overflowX: "visible" }}
      >
        {TAB_GROUPS.flatMap((group, index) => [
          <span
            key={`group-${group.label}`}
            aria-hidden
            // A caption, not a tab: not focusable, never in the roving-
            // tabindex sequence LTabsTrigger reads off the DOM. Hidden in
            // the wrapped row (see the header comment), a section header
            // above its cluster in the sidebar.
            className={`hidden whitespace-nowrap pl-3 pb-1 text-caption font-medium uppercase tracking-wide text-ink-3 lg:block ${
              index === 0 ? "" : "lg:pt-4"
            }`}
          >
            {group.label}
          </span>,
          ...group.keys.map((key) => (
            <LTabsTrigger key={key} value={key} className={triggerClass}>
              {TAB_LABEL[key]}
            </LTabsTrigger>
          )),
        ])}
        <LTabsTrigger value="profile" className={`${triggerClass} lg:mt-4`}>
          {TAB_LABEL.profile}
        </LTabsTrigger>
      </LTabsList>

      <div className="min-w-0 pt-4 lg:pt-0">
        {panels.map((panel) => (
          <LTabsContent key={panel.key} value={panel.key}>
            {panel.content}
          </LTabsContent>
        ))}
      </div>
    </LTabsRoot>
  );
}
