"use client";

import * as React from "react";
import { cn } from "@/lib/ledger/cn";

/**
 * LEDGER — Segmented control (a two-or-more-option pill toggle).
 *
 * This shape was reinvented twice in the auth flow — signup-form.tsx's
 * account-type switch and welcome-actions.tsx's billing-interval switch,
 * both noting "in place of Radix's SegmentedControl" — and BOTH shipped the
 * same accessibility hole: `role="radiogroup"` with `role="radio"` buttons,
 * every button its own tab stop and no arrow-key movement between them. The
 * WAI-ARIA radio pattern is the opposite: ONE tab stop for the whole group
 * (roving tabindex), and Arrow/Home/End move the selection. A keyboard user
 * meeting the old version had to Tab through each option and could never
 * arrow between them the way a native radio group allows.
 *
 * This is that pattern, once, correctly:
 *   - roving tabindex — only the checked option is tabbable; the rest are
 *     -1 and reached by arrow keys.
 *   - Arrow Right/Down → next, Left/Up → previous, both wrapping; Home/End
 *     jump to the ends. Moving selects (radio semantics), matching native.
 *   - controlled only, no internal state — the caller owns `value`, exactly
 *     like the two hand-rolled versions it replaces, so the "post through a
 *     hidden input" pattern each caller uses is unaffected.
 *
 * Not a native <input type=radio> group (which would give keyboard for
 * free): the visible control is a row of buttons with no single focusable
 * element a <label> could point at, so it's named by aria-label/labelledBy
 * and the radio semantics are supplied by hand — the same reason the Radix
 * version existed.
 */
export function LSegmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  labelledBy,
  describedBy,
  fullWidth = false,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  /** One of ariaLabel / labelledBy names the group; pass whichever fits. */
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  /** Stretch the group and its options to fill the row (signup). */
  fullWidth?: boolean;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function move(nextIndex: number) {
    const count = options.length;
    // Wrap at both ends, the way a native radio group does.
    const i = ((nextIndex % count) + count) % count;
    const opt = options[i];
    if (!opt) return;
    onChange(opt.value);
    // Focus the target now; its tabindex flips to 0 on the re-render this
    // onChange triggers. Programmatic focus works regardless of tabindex.
    refs.current[i]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(index - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(options.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={cn(
        "inline-flex gap-1 rounded-control border border-hair-strong bg-sunk p-1",
        fullWidth && "w-full",
        className
      )}
    >
      {options.map((opt, index) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // Roving tabindex: the checked option is the group's one tab stop.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "rounded-control px-3 py-1.5 text-body-s font-medium transition-colors " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              fullWidth && "flex-1",
              active ? "bg-card text-ink shadow-card" : "text-ink-2 hover:text-ink"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
