"use client";

import * as React from "react";
import { cx } from "@/lib/ds/props";

/**
 * INSTRUMENT — Tabs.
 *
 * The one component here that is genuinely hand-built rather than a platform
 * element, because there is no native tab control. It implements the WAI-ARIA
 * tabs pattern, and the part that matters is the ROVING TABINDEX: exactly one
 * tab is in the page's tab order at a time, and the arrow keys move between
 * them. A tablist where every tab is tabbable means a keyboard user has to
 * Tab through all twelve to reach the panel, which is the whole reason the
 * pattern exists.
 *
 * Deliberately uncontrolled-by-default with a controlled escape hatch, since
 * both call sites in the product today just want it to work.
 */

export interface TabItem {
  value: string;
  label: React.ReactNode;
}

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  children,
  className,
}: {
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Names the tablist for screen readers — required, not decorative. */
  label: string;
  /** Rendered below the tablist; receives nothing, call sites branch on value. */
  children?: React.ReactNode;
  className?: string;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(
    defaultValue ?? items[0]?.value
  );
  const current = value ?? uncontrolled;
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  function select(next: string) {
    if (value === undefined) setUncontrolled(next);
    onValueChange?.(next);
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    // Home/End as well as the arrows: with twelve settings tabs, "jump to the
    // last one" is a real need and arrow-only makes it eleven keypresses.
    const map: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: items.length - 1,
    };
    const target = map[e.key];
    if (target === undefined) return;
    e.preventDefault();
    // Wrap, so ArrowRight on the last tab returns to the first — the pattern's
    // documented behaviour, and what a keyboard user expects from a ring.
    const next = (target + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    select(item.value);
    refs.current[next]?.focus();
  }

  return (
    <div className={className}>
      <div className="i-tabs" role="tablist" aria-label={label}>
        {items.map((item, i) => {
          const selected = item.value === current;
          return (
            <button
              key={item.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${item.value}`}
              aria-selected={selected}
              aria-controls={`panel-${item.value}`}
              // THE ROVING TABINDEX. Only the selected tab is reachable by
              // Tab; the rest are reachable by arrow key from it.
              tabIndex={selected ? 0 : -1}
              className={cx("i-tab")}
              onClick={() => select(item.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`panel-${current}`}
        aria-labelledby={`tab-${current}`}
        // tabIndex 0 so the panel itself is focusable: after activating a tab,
        // the next Tab press lands in the panel's content rather than skipping
        // past it to the next tablist entry.
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
