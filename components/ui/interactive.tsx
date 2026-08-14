"use client";

import * as React from "react";
import { DialogShell } from "@/components/ds/dialog";
import { Box } from "@/components/ds/layout";
import { cx } from "@/lib/ds/props";

/**
 * The stateful half of the migration seam — see components/ui/index.tsx.
 *
 * SPLIT OUT FOR A SPECIFIC REASON, worth recording because the symptom was
 * baffling. With "use client" on the whole seam, every
 * `<Text asChild><NextLink/></Text>` written inside a SERVER component had its
 * children cross the RSC boundary, where React hands them over as a LAZY
 * CLIENT REFERENCE rather than an element. React.isValidElement is false for
 * that object, so asChild threw — and React's own message names no component,
 * which is exactly what the named errors in components/ds/type.tsx were added
 * to fix.
 *
 * So the seam's presentational components (Text, Card, Button, Table…) stay
 * server-capable, and only the ones that genuinely hold state live here. A
 * client component re-exported from a server module is fine; the reverse is
 * not.
 */

type Step = "1" | "2" | "3" | "4" | "5" | "6" | "7";
type Spacing = string | Record<string, string>;

/** Radix's sizes ran 1-9; INSTRUMENT runs 1-7. */
function sizeOf(size?: string): Step | undefined {
  if (!size) return undefined;
  return String(Math.min(7, Math.max(1, Number(size) || 3))) as Step;
}

/* ── ALERT DIALOG ────────────────────────────────────────────────────── */
const AlertCtx = React.createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
  open: false,
  setOpen: () => {},
});

function AlertRoot({
  open: controlled,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const open = controlled ?? uncontrolled;
  const setOpen = React.useCallback(
    (v: boolean) => {
      if (controlled === undefined) setUncontrolled(v);
      onOpenChange?.(v);
    },
    [controlled, onOpenChange]
  );
  return <AlertCtx.Provider value={{ open, setOpen }}>{children}</AlertCtx.Provider>;
}

function cloneWithClick(children: React.ReactNode, onAfter: () => void) {
  const child = React.Children.only(children) as React.ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
  }>;
  return React.cloneElement(child, {
    onClick: (e: React.MouseEvent) => {
      child.props.onClick?.(e);
      onAfter();
    },
  } as never);
}

export const AlertDialogRoot = AlertRoot;
const _AlertDialogParts = {
  Root: AlertRoot,
  /** Clones its single child and opens on click — the behaviour Radix's
   *  Trigger supplied, which the child Button does not have on its own. */
  Trigger: function AlertTrigger({ children }: { children?: React.ReactNode }) {
    const { setOpen } = React.useContext(AlertCtx);
    return cloneWithClick(children, () => setOpen(true));
  },
  Content: function AlertContent({
    children,
    maxWidth,
  }: {
    children?: React.ReactNode;
    maxWidth?: string;
  }) {
    const { open, setOpen } = React.useContext(AlertCtx);
    return (
      <DialogShell open={open} onOpenChange={setOpen} labelledBy="i-alert-title">
        <div className="i-dialog-body" style={maxWidth ? { maxWidth } : undefined}>
          {children}
        </div>
      </DialogShell>
    );
  },
  Title: function AlertTitle({ children }: { children?: React.ReactNode }) {
    return (
      <h2 className="i-heading i-t4" id="i-alert-title">
        {children}
      </h2>
    );
  },
  Description: function AlertDescription({
    children,
    size,
  }: {
    children?: React.ReactNode;
    size?: string;
  }) {
    return <p className={cx("i-text", `i-t${sizeOf(size) ?? "2"}`, "i-tone-muted")}>{children}</p>;
  },
  Cancel: function AlertCancel({ children }: { children?: React.ReactNode }) {
    const { setOpen } = React.useContext(AlertCtx);
    return cloneWithClick(children, () => setOpen(false));
  },
  Action: function AlertAction({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
};

/* ── TABS ────────────────────────────────────────────────────────────── */
const TabsCtx = React.createContext<{ value: string; setValue: (v: string) => void }>({
  value: "",
  setValue: () => {},
});

const _TabsParts = {
  Root: function TabsRoot({
    value: controlled,
    defaultValue,
    onValueChange,
    children,
    ...rest
  }: {
    value?: string;
    defaultValue?: string;
    onValueChange?: (v: string) => void;
    children?: React.ReactNode;
  } & Record<string, unknown>) {
    const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "");
    const value = controlled ?? uncontrolled;
    const setValue = React.useCallback(
      (v: string) => {
        if (controlled === undefined) setUncontrolled(v);
        onValueChange?.(v);
      },
      [controlled, onValueChange]
    );
    return (
      <TabsCtx.Provider value={{ value, setValue }}>
        <div {...(rest as Record<string, never>)}>{children}</div>
      </TabsCtx.Provider>
    );
  },
  List: function TabsList({
    children,
    color: _color,
    ...rest
  }: { children?: React.ReactNode; color?: string } & Record<string, unknown>) {
    return (
      <div className="i-tabs" role="tablist" {...(rest as Record<string, never>)}>
        {children}
      </div>
    );
  },
  Trigger: function TabsTrigger({
    value,
    children,
  }: {
    value: string;
    children?: React.ReactNode;
  }) {
    const ctx = React.useContext(TabsCtx);
    const selected = ctx.value === value;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        // Roving tabindex, matching components/ds/tabs.tsx: only the selected
        // tab sits in the page's tab order.
        tabIndex={selected ? 0 : -1}
        className="i-tab"
        onClick={() => ctx.setValue(value)}
      >
        {children}
      </button>
    );
  },
  Content: function TabsContent({
    value,
    children,
    forceMount,
    style,
  }: {
    value: string;
    children?: React.ReactNode;
    /** Radix kept the panel mounted and hid it. Honoured, because the
     *  settings tabs rely on it: an unmounted panel loses the form state a
     *  pilot typed before switching tabs. */
    forceMount?: boolean;
    style?: React.CSSProperties;
  }) {
    const ctx = React.useContext(TabsCtx);
    const active = ctx.value === value;
    if (!active && !forceMount) return null;
    return (
      <div role="tabpanel" hidden={!active} style={active ? style : { display: "none" }}>
        {children}
      </div>
    );
  },
};

/* ── THEME ───────────────────────────────────────────────────────────────
   Radix's <Theme> is gone. Appearance and density are data attributes now
   (app/design/tokens.css declares the palette against them), so this renders
   a plain element carrying the attribute — which is exactly what lets the nav
   rail be a dark island with no second stylesheet and no component override.
   Kept so the few call sites still writing <Theme> compile; stage 6 removes
   them. */
export function Theme({
  appearance,
  children,
  asChild,
  accentColor: _accent,
  scaling: _scaling,
  grayColor: _gray,
  panelBackground: _panel,
  radius: _radius,
  ...rest
}: {
  appearance?: string;
  children?: React.ReactNode;
  asChild?: boolean;
  accentColor?: string;
  scaling?: string;
  grayColor?: string;
  panelBackground?: string;
  radius?: string;
} & Record<string, unknown>) {
  const attrs = appearance ? { "data-appearance": appearance } : {};
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<Record<string, unknown>>;
    return React.cloneElement(child, { ...attrs, ...(rest as object) } as never);
  }
  return (
    <div {...attrs} {...(rest as Record<string, never>)}>
      {children}
    </div>
  );
}


/* ── COMPONENTS THE FIRST SURVEY MISSED ──────────────────────────────────
   Found by compiling, not by grepping: the earlier count only looked at what
   each file imported by name at the top, and these six appear in files whose
   import lists ran to two dozen entries. Listed here with the same
   translate-don't-emulate rule as everything above. */

/** Radix's Section was vertical rhythm and nothing else. */
export function Section({
  size,
  children,
  ...rest
}: { size?: Spacing; children?: React.ReactNode; id?: string; style?: React.CSSProperties } & Record<string, unknown>) {
  // The size step was a spacing scale position, so it maps onto py directly.
  return (
    <Box asChild py={(size as never) ?? "6"} {...(rest as Record<string, never>)}>
      <section>{children}</section>
    </Box>
  );
}

/** A loading placeholder. Deliberately NOT animated: this product renders
 *  skeletons for tables of figures, and a shimmer across a dense grid reads
 *  as the data moving. A static sunk block says "not here yet" and stops. */
export function Skeleton({
  width,
  height,
  children,
}: {
  width?: string;
  height?: string;
  children?: React.ReactNode;
}) {
  if (children) return <>{children}</>;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: width ?? "100%",
        height: height ?? "var(--lh-3)",
        background: "var(--sunk)",
        borderRadius: "var(--radius)",
      }}
    />
  );
}

/* Radio group, radio cards and the segmented control are three Radix
   components over ONE native control: a group of radios. They differ only in
   skin, so they share an implementation and differ in the class they carry —
   which is also why all three are keyboard- and screen-reader-correct without
   a line of key handling here. */
const RadioCtx = React.createContext<{
  name: string;
  value?: string;
  setValue: (v: string) => void;
}>({ name: "", setValue: () => {} });

function RadioGroupRoot({
  value,
  defaultValue,
  onValueChange,
  name,
  children,
  ...rest
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  name?: string;
  children?: React.ReactNode;
} & Record<string, unknown>) {
  const generated = React.useId();
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const current = value ?? uncontrolled;
  const setValue = React.useCallback(
    (v: string) => {
      if (value === undefined) setUncontrolled(v);
      onValueChange?.(v);
    },
    [value, onValueChange]
  );
  return (
    <RadioCtx.Provider value={{ name: name ?? generated, value: current, setValue }}>
      {/* role=radiogroup so the set is announced as one control even though
          the radios are plain inputs scattered through the markup. */}
      <div role="radiogroup" {...(rest as Record<string, never>)}>
        {children}
      </div>
    </RadioCtx.Provider>
  );
}

function RadioItem({
  value,
  children,
  ...rest
}: { value: string; children?: React.ReactNode } & Record<string, unknown>) {
  const ctx = React.useContext(RadioCtx);
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}
      {...(rest as Record<string, never>)}
    >
      <input
        type="radio"
        className="i-check"
        name={ctx.name}
        value={value}
        checked={ctx.value === value}
        onChange={() => ctx.setValue(value)}
      />
      <span>{children}</span>
    </label>
  );
}

export { RadioGroupRoot, RadioItem };

/** A label/value list — the shape every "details" panel in this product uses. */
const _DataListParts = {
  Root: function DataListRoot({
    children,
    ...rest
  }: { children?: React.ReactNode } & Record<string, unknown>) {
    return (
      <dl
        style={{ display: "grid", gap: "var(--space-2)", margin: 0 }}
        {...(rest as Record<string, never>)}
      >
        {children}
      </dl>
    );
  },
  Item: function DataListItem({ children }: { children?: React.ReactNode } & Record<string, unknown>) {
    return (
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>{children}</div>
    );
  },
  Label: function DataListLabel({
    children,
  }: { children?: React.ReactNode } & Record<string, unknown>) {
    return <dt className="i-caps" style={{ minWidth: "14ch" }}>{children}</dt>;
  },
  Value: function DataListValue({
    children,
  }: { children?: React.ReactNode } & Record<string, unknown>) {
    return <dd style={{ margin: 0 }}>{children}</dd>;
  },
};


/* ── EXPORTED AS FUNCTIONS, NOT AS OBJECTS ───────────────────────────────
   This module carries "use client", so every export crosses the RSC
   boundary as a CLIENT REFERENCE. A function survives that intact. An OBJECT
   does not: it arrives as an opaque proxy, and reading a property off it from
   a server component yields undefined — which React reports as
   "Element type is invalid ... got: undefined", naming nothing.

   That is not hypothetical here: app/(app)/settings/billing/page.tsx is a
   server component that renders <DataList.Root>. So each part is exported by
   name below, and components/ui/index.tsx — a SERVER module — assembles the
   compound objects from them. The object is then a real object whose values
   happen to be client references, which is the arrangement that works. */
export const AlertDialogTrigger = _AlertDialogParts.Trigger;
export const AlertDialogContent = _AlertDialogParts.Content;
export const AlertDialogTitle = _AlertDialogParts.Title;
export const AlertDialogDescription = _AlertDialogParts.Description;
export const AlertDialogCancel = _AlertDialogParts.Cancel;
export const AlertDialogAction = _AlertDialogParts.Action;

export const TabsRoot = _TabsParts.Root;
export const TabsList = _TabsParts.List;
export const TabsTrigger = _TabsParts.Trigger;
export const TabsContent = _TabsParts.Content;

export const DataListRoot = _DataListParts.Root;
export const DataListItem = _DataListParts.Item;
export const DataListLabel = _DataListParts.Label;
export const DataListValue = _DataListParts.Value;
