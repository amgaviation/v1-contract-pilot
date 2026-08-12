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
 * Defaults applied here, and the reasoning (values per the 2026-08 design
 * rebuild — docs/design/REBUILD-BRIEF.md §5):
 *
 *   Card            variant="surface" was "ghost". The rebuild's single
 *                                     biggest lever: the app's ~144 Card
 *                                     call sites flip from flat regions to
 *                                     bordered white panels on the gray-2
 *                                     canvas at once. Marketing already
 *                                     passes variant="surface" explicitly
 *                                     at its mock/pricing call sites, so
 *                                     nothing doubles up. The ghost-outdent
 *                                     rule in globals.css stays as a
 *                                     dormant guard for any future
 *                                     explicit ghost call site.
 *   TextField.Root  variant="surface" was soft/size-1/gray. Bordered
 *                   size="2"          inputs match bordered panels, and
 *                                     size 2 (28.8px at 90% scaling)
 *                                     retires the WCAG 2.5.8 target-size
 *                                     debt the previous header recorded —
 *                                     the "two-word edit" it promised.
 *   Select.Trigger  variant="surface" matches TextField's default look so
 *                                     the two read as one input family.
 *   Select.Root     (no size default) Radix's own Root default is size
 *                                     "2", which now matches
 *                                     TextField.Root above, so the
 *                                     explicit size="1" default this file
 *                                     used to set is gone rather than
 *                                     rewritten — the two input families
 *                                     must move in lockstep or mixed
 *                                     forms go ragged, and letting Radix's
 *                                     default supply the "2" keeps exactly
 *                                     one place (TextField's default
 *                                     above) where that number is chosen.
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
 *   Tabs.List       color="indigo"    tracks the Theme accent (was "blue"
 *                                     when the accent was) so the active
 *                                     tab indicator is never ambiguous.
 *                                     Tabs.List's color is not documented
 *                                     as inheriting the accent the way
 *                                     radius does, so leaving it implicit
 *                                     would be relying on unspecified
 *                                     Radix behaviour instead of stating
 *                                     the intent.
 *   Spinner         size="3"          the app's one default loading size;
 *                                     inline spinners override down.
 *   Text            (no default)      the weight="light" body-copy default
 *                                     is REMOVED, not resettled: light
 *                                     text at size 1–2 over 90% scaling is
 *                                     thin on glass in daylight (pilots
 *                                     read this on phones at FBOs), so
 *                                     body copy is back on Radix's regular
 *                                     — the Linear/Stripe register. The
 *                                     one explicit weight="light" call
 *                                     site (marketing hero sub-line)
 *                                     keeps its prop and is unaffected.
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
 *   Button radius default      Redundant, not rejected on the merits: the
 *                               Theme's radius (now "small" — it was
 *                               "none" when this entry was first written;
 *                               same conclusion either way) is inherited
 *                               by Radix Buttons — setting it again here
 *                               would do nothing but suggest, wrongly,
 *                               that Button radius can vary independently
 *                               of the Theme.
 */

import * as React from "react";
import {
  Card as RadixCard,
  type CardProps,
  Badge as RadixBadge,
  type BadgeProps,
  Spinner as RadixSpinner,
  type SpinnerProps,
  TextField as RadixTextField,
  Select as RadixSelect,
  Callout as RadixCallout,
  Tabs as RadixTabs,
} from "@radix-ui/themes";

export * from "@radix-ui/themes";

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  function Card(props, ref) {
    return <RadixCard ref={ref} variant="surface" {...props} />;
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

// Text is deliberately NOT wrapped: with the weight="light" default
// removed (see header), the star re-export above supplies Radix's Text
// unchanged, and adding a pass-through wrapper here would only suggest a
// default exists where none does.

const TextFieldRoot = React.forwardRef<
  HTMLInputElement,
  RadixTextField.RootProps
>(function TextFieldRoot(props, ref) {
  return (
    <RadixTextField.Root
      ref={ref}
      variant="surface"
      size="2"
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
  return <RadixSelect.Trigger ref={ref} variant="surface" {...props} />;
});

// Select.Root carries no default any more: Radix's own Root size default
// is "2", which is exactly what TextField.Root's size="2" above needs it
// to be. (size is a Select.Root prop, not a Select.Trigger prop — Trigger
// reads it from Root's context — so if the two input families ever move
// again, the size default goes back HERE, on Root, not on Trigger.)
export const Select = {
  ...RadixSelect,
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
    return <RadixTabs.List ref={ref} color="indigo" {...props} />;
  }
);

export const Tabs = {
  ...RadixTabs,
  List: TabsList,
};
