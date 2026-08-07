/**
 * The product's single component-defaults layer.
 *
 * Every other file in app/, lib/ and components/ imports Radix Themes
 * components from HERE ("@/components/ui"), never from "@radix-ui/themes"
 * directly — scripts/verify-tokens.mjs enforces that mechanically. This
 * file re-exports everything Radix Themes exports, unchanged, EXCEPT for
 * the small list of components below, each given one chosen default prop
 * value. This is the ONLY place in the product a component default may
 * live. If a screen needs a different look than the default, it passes
 * the prop explicitly at the call site — every default here is designed
 * to be overridden, never enforced.
 *
 * Defaults applied here, and the reasoning:
 *
 *   Card            variant="ghost"   flat by default; call sites that
 *                                     want a bordered/surfaced card ask
 *                                     for it explicitly.
 *   TextField.Root  variant="soft"    quieter inputs across a form-heavy
 *                   size="1"          product; "1" matches the app's
 *                   color="gray"      dense scaling; gray keeps focus on
 *                                     content, not chrome.
 *   Select.Trigger  variant="soft"    matches TextField's default look so
 *                   color="gray"      the two read as one input family.
 *   Select.Root     size="1"          TextField.Root defaults to size="1"
 *                                     (21.6px tall at this app's 90%
 *                                     scaling), but Select's size is a
 *                                     Select.Root prop, not a
 *                                     Select.Trigger prop — Trigger reads
 *                                     it from Root's context — so the
 *                                     default has to go on Root, not
 *                                     Trigger. Without it Root defaults
 *                                     to Radix's size 2 (28.8px), and
 *                                     every form mixing TextField and
 *                                     Select was visibly ragged.
 *                                     HONEST NOTE: a 21.6px-tall control
 *                                     is below the 24x24 CSS-px minimum
 *                                     in WCAG 2.5.8 Target Size (Minimum),
 *                                     and this product is used on a
 *                                     phone. This is the owner's explicit
 *                                     choice to match TextField, not an
 *                                     oversight — if that trade is
 *                                     revisited, bumping both
 *                                     TextField.Root and Select.Root
 *                                     to size="2" is a two-word edit.
 *   Badge           variant="solid"   status badges (paid/void/overdue)
 *                   color="red"       need to read at a glance. This
 *                                     default currently governs nothing:
 *                                     all 10 Badge call sites in the
 *                                     product pass color explicitly. It
 *                                     stays for the next call site that
 *                                     doesn't — and the choice of red is
 *                                     deliberate, not arbitrary, because
 *                                     red is this product's "overdue /
 *                                     not current" colour: a future Badge
 *                                     that forgets to set a color would
 *                                     silently read as a failure state.
 *   Callout.Root    color="amber"     the product's default callout is a
 *                                     caution, not an error or a tip.
 *                                     Also currently inert: all 24
 *                                     Callout.Root call sites pass color
 *                                     explicitly (18 red, 4 amber, 2
 *                                     green) — this is what a future
 *                                     unlabelled Callout falls back to.
 *   Tabs.List       color="blue"      matches the accent so the active tab
 *                                     indicator is never ambiguous. There
 *                                     is exactly one Tabs.List call site
 *                                     today, and the Theme's accentColor
 *                                     is already "blue" (app/layout.tsx),
 *                                     so this is currently a no-op there
 *                                     — by the same "redundant, not
 *                                     rejected" reasoning the header
 *                                     below applies to Button
 *                                     radius="none". Unlike that case,
 *                                     this default is kept rather than
 *                                     omitted: Tabs.List's color is not
 *                                     documented as inheriting the accent
 *                                     the way radius does, so leaving it
 *                                     implicit would be relying on
 *                                     unspecified Radix behaviour instead
 *                                     of stating the intent.
 *   Spinner         size="3"          the app's one default loading size;
 *                                     inline spinners override down.
 *   Text            weight="light"    the app's body-copy weight is
 *                                     lighter than Radix's regular default.
 *
 * REJECTED — decisions the owner made and is recording here so they are
 * not re-litigated by a future "shouldn't this also have a default?":
 *
 *   Button variant="surface"   Rejected. Primary actions stay solid (the
 *                               Radix default) so "Create invoice" still
 *                               reads as the main action next to its
 *                               outline neighbours. A surface default
 *                               would flatten that hierarchy.
 *   Text color="gray"          Rejected. 180 of this product's 440 Text
 *                               elements set no colour today. Defaulting
 *                               all of them to gray would mute every one
 *                               at once and collapse the visible step
 *                               between primary and secondary copy.
 *   Button radius="none"       Redundant, not rejected on the merits: the
 *                               Theme's radius is already "none"
 *                               (app/layout.tsx) and Radix Buttons inherit
 *                               it — setting it again here would do
 *                               nothing but suggest, wrongly, that Button
 *                               radius can vary independently of the
 *                               Theme.
 */

import * as React from "react";
import {
  Card as RadixCard,
  type CardProps,
  Badge as RadixBadge,
  type BadgeProps,
  Spinner as RadixSpinner,
  type SpinnerProps,
  Text as RadixText,
  type TextProps,
  TextField as RadixTextField,
  Select as RadixSelect,
  Callout as RadixCallout,
  Tabs as RadixTabs,
} from "@radix-ui/themes";

export * from "@radix-ui/themes";

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  function Card(props, ref) {
    return <RadixCard ref={ref} variant="ghost" {...props} />;
  }
);

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  function Badge(props, ref) {
    return <RadixBadge ref={ref} variant="solid" color="red" {...props} />;
  }
);

export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(
  function Spinner(props, ref) {
    return <RadixSpinner ref={ref} size="3" {...props} />;
  }
);

export const Text = React.forwardRef<HTMLSpanElement, TextProps>(
  function Text(props, ref) {
    return <RadixText ref={ref} weight="light" {...props} />;
  }
) as typeof RadixText;

const TextFieldRoot = React.forwardRef<
  HTMLInputElement,
  RadixTextField.RootProps
>(function TextFieldRoot(props, ref) {
  return (
    <RadixTextField.Root
      ref={ref}
      variant="soft"
      size="1"
      color="gray"
      {...props}
    />
  );
});

export const TextField = {
  ...RadixTextField,
  Root: TextFieldRoot,
};

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  RadixSelect.TriggerProps
>(function SelectTrigger(props, ref) {
  return (
    <RadixSelect.Trigger ref={ref} variant="soft" color="gray" {...props} />
  );
});

// size is NOT a Select.Trigger prop in @radix-ui/themes — it lives on
// Select.Root (selectRootPropDefs, defaulting to "2") and is read from
// context by Trigger/Content/Item. So the size default has to be applied
// here, on Root, not on Trigger above; see this file's header for why it
// exists at all.
function SelectRoot(props: RadixSelect.RootProps) {
  return <RadixSelect.Root size="1" {...props} />;
}

export const Select = {
  ...RadixSelect,
  Root: SelectRoot,
  Trigger: SelectTrigger,
};

const CalloutRoot = React.forwardRef<
  HTMLDivElement,
  RadixCallout.RootProps
>(function CalloutRoot(props, ref) {
  return <RadixCallout.Root ref={ref} color="amber" {...props} />;
});

export const Callout = {
  ...RadixCallout,
  Root: CalloutRoot,
};

const TabsList = React.forwardRef<HTMLDivElement, RadixTabs.ListProps>(
  function TabsList(props, ref) {
    return <RadixTabs.List ref={ref} color="blue" {...props} />;
  }
);

export const Tabs = {
  ...RadixTabs,
  List: TabsList,
};
