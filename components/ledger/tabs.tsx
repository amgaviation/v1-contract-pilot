"use client";

import * as React from "react";
import { cn } from "@/lib/ledger/cn";

/**
 * LEDGER — Tabs, ported from components/ds/tabs.tsx's roving-tabindex
 * implementation (read that file's header for why a hand-built tablist is
 * the right call — there is no native tab control). This port trades that
 * file's `items` array for a compound Root/List/Trigger/Content API,
 * because settings-tabs.tsx's call site needs every panel MOUNTED at once
 * (mid-edit rows must survive a tab switch) — the same reason that file's
 * own Tabs.Content already carried `forceMount`. LTabsContent renders its
 * children unconditionally (`hidden`, not unmounted) so presence never
 * depends on which tab is active.
 *
 * Controlled only: every call site in this app already owns `value` (a
 * `?tab=` deep link, in settings' case), so the uncontrolled branch
 * components/ds/tabs.tsx supports has no port here.
 *
 * Activation order for Arrow/Home/End is read straight from the DOM
 * (`[role="tab"]` inside the nearest `[role="tablist"]`) rather than a
 * registered index list — settings' grouped strip interleaves
 * non-interactive group labels between triggers, so a static index would
 * drift the moment that grouping changes.
 */

const TabsValueContext = React.createContext<string | null>(null);
const TabsOnChangeContext = React.createContext<((value: string) => void) | null>(null);

function useTabsValue(component: string) {
  const value = React.useContext(TabsValueContext);
  if (value === null) throw new Error(`${component} must be used inside <LTabsRoot>`);
  return value;
}

function useTabsOnChange(component: string) {
  const onChange = React.useContext(TabsOnChangeContext);
  if (!onChange) throw new Error(`${component} must be used inside <LTabsRoot>`);
  return onChange;
}

export function LTabsRoot({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TabsValueContext.Provider value={value}>
      <TabsOnChangeContext.Provider value={onValueChange}>
        <div className={className}>{children}</div>
      </TabsOnChangeContext.Provider>
    </TabsValueContext.Provider>
  );
}

export function LTabsList({
  "aria-label": ariaLabel,
  children,
  className,
  style,
}: {
  "aria-label": string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex items-center gap-4 overflow-x-auto border-b border-hair", className)}
      style={style}
    >
      {children}
    </div>
  );
}

export function LTabsTrigger({
  value: tabValue,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const value = useTabsValue("LTabsTrigger");
  const onValueChange = useTabsOnChange("LTabsTrigger");
  const ref = React.useRef<HTMLButtonElement>(null);
  const selected = tabValue === value;

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const container = ref.current?.closest('[role="tablist"]');
    if (!container) return;
    const list = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    );
    const values = list.map((btn) => btn.dataset.value ?? "");
    const index = values.indexOf(tabValue);
    // Up/Down mirror Right/Left so the same tablist works laid out as a
    // vertical sidebar (settings' lg+ layout) as well as a horizontal
    // strip. Supporting both axes at once is the accepted pattern when a
    // tablist's orientation is responsive rather than fixed.
    const map: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: values.length - 1,
    };
    const target = map[e.key];
    if (target === undefined || index === -1) return;
    e.preventDefault();
    const nextIndex = (target + values.length) % values.length;
    const next = values[nextIndex];
    if (!next) return;
    onValueChange(next);
    list[nextIndex]?.focus();
  }

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      data-value={tabValue}
      id={`ltab-${tabValue}`}
      aria-selected={selected}
      aria-controls={`ltabpanel-${tabValue}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => onValueChange(tabValue)}
      onKeyDown={onKeyDown}
      className={cn(
        "-mb-px shrink-0 whitespace-nowrap border-b-2 px-1 py-2.5 text-body-s font-medium transition-colors duration-150 ease-ledger",
        selected
          ? "border-accent text-ink"
          : "border-transparent text-ink-2 hover:text-ink",
        className
      )}
    >
      {children}
    </button>
  );
}

export function LTabsContent({
  value: tabValue,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const value = useTabsValue("LTabsContent");
  const active = tabValue === value;
  return (
    <div
      role="tabpanel"
      id={`ltabpanel-${tabValue}`}
      aria-labelledby={`ltab-${tabValue}`}
      hidden={!active}
      tabIndex={active ? 0 : -1}
      className={className}
    >
      {children}
    </div>
  );
}
