"use client";

import { useState } from "react";
import { Box, Tabs, Text } from "@/components/ui";
import type { ReactNode } from "react";

/**
 * The tab vocabulary, written once. It grew from three to six with Phase
 * 9's customisation layer, and to seven with the profile/security surface,
 * and a hand-written `a || b || c` predicate was exactly the shape that
 * goes stale each time — so the list IS the type and the type guard reads
 * from the list.
 *
 * Nine tabs is past Miller's 7±2 as a single flat row, so the strip below
 * clusters them under three small, non-interactive group labels —
 * "Business" (business, day-types, mileage, categories), "Communication"
 * (messages, reminders) and "Appearance" (appearance, layout); see
 * TAB_GROUPS below. TAB_KEYS itself stays exactly this one flat list of
 * nine values: the grouping is a rendering concern in the JSX, not a
 * change to the type, the `?tab=` vocabulary, or the state machine —
 * still ONE Tabs.Root and ONE Tabs.List, so Left/Right/Home/End and the
 * roving tabindex still walk all nine triggers in a single sequence.
 * "profile" stays outside all three groups; see the comment below for why.
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

/** Display text for each trigger, keyed once so the grouped tab row and
 *  the (label-free) panel row below never have to repeat it. */
const TAB_LABEL: Record<TabKey, string> = {
  business: "Your business",
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
 * The visual grouping for the tab STRIP only — see the header comment
 * above. Each group renders as a small `aria-hidden` label (the same
 * size="1"/color="gray"/weight="medium" idiom overview/page.tsx uses for
 * its KPI group labels) followed by that group's triggers, all still
 * inside the one Tabs.List. "profile" is deliberately absent from every
 * group here: it renders last, on its own, with no label before it.
 */
const TAB_GROUPS: { label: string; keys: TabKey[] }[] = [
  { label: "Business", keys: ["business", "day-types", "mileage", "categories"] },
  { label: "Communication", keys: ["messages", "reminders"] },
  { label: "Appearance", keys: ["appearance", "layout"] },
];

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
 * hand-rolled version had to build by hand. The small group labels
 * rendered between clusters of triggers (see TAB_GROUPS) are plain
 * `aria-hidden` text, not `Tabs.Trigger`s: they sit in the list's flex
 * flow purely for visual spacing and never join that roving-tabindex
 * sequence, so keyboard users still land on all nine real tabs in order.
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

  const panels: { key: TabKey; content: ReactNode }[] = [
    { key: "business", content: business },
    { key: "day-types", content: dayTypes },
    { key: "mileage", content: mileage },
    { key: "messages", content: messages },
    { key: "reminders", content: reminders },
    { key: "appearance", content: appearance },
    { key: "layout", content: layout },
    { key: "categories", content: categories },
    { key: "profile", content: profile },
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
        {TAB_GROUPS.flatMap((group, index) => [
          <Text
            key={`group-${group.label}`}
            size="1"
            color="gray"
            weight="medium"
            aria-hidden
            // Not a tab, not focusable, not in the roving-tabindex sequence
            // Tabs.Trigger builds (see the header comment) — a caption that
            // happens to sit inside the same flex row as the triggers.
            // `nowrap` so a group name can never wrap into its own row and
            // overlap the wrapped trigger row below it; the doubled-up `ml`
            // before every group after the first (same --space-4 token the
            // triggers already use for their own gap) is the only thing
            // marking a new cluster having started, since flex-wrap alone
            // would otherwise run every trigger into one visually even row.
            ml={index === 0 ? undefined : "4"}
            style={{ whiteSpace: "nowrap" }}
          >
            {group.label}
          </Text>,
          ...group.keys.map((key) => (
            <Tabs.Trigger key={key} value={key}>
              {TAB_LABEL[key]}
            </Tabs.Trigger>
          )),
        ])}
        <Tabs.Trigger value="profile">{TAB_LABEL.profile}</Tabs.Trigger>
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
