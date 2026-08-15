"use client";

import { useState } from "react";
import { cn } from "@/lib/ledger/cn";

/**
 * H9: "Skip to content" — invisible until it has focus, then pinned
 * top-left above everything else. First focusable element on the page,
 * so a keyboard or screen-reader user tabbing in lands here before the
 * (now much longer, on a phone) chain of nav links.
 *
 * A tiny client component rather than a Tailwind-only construction: the
 * reveal is driven by component state (`focused`) toggling which position
 * class applies, not by a `:focus` variant on the anchor itself, so the
 * exact same show/hide behaviour survives the move to Ledger utilities
 * unchanged. Styling is entirely Tailwind against ledger.css's tokens
 * (`components/ledger` primitives are the same discipline) — no i-*
 * classes, no var() in this file, so scripts/verify-tokens.mjs's rules
 * have nothing to check here.
 *
 * The transition is `transition-[top] duration-150` — under 200ms, per
 * LEDGER's own restraint on motion, and the same 150ms this control has
 * always used (previously spelled `transition: "top 0.15s ease-in-out"`
 * inline).
 */
export default function SkipLink() {
  const [focused, setFocused] = useState(false);

  return (
    <a
      href="#main-content"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn(
        "absolute left-2 z-[1000] rounded-control bg-accent px-3 py-2 text-body-s font-medium text-accent-ink no-underline transition-[top] duration-150",
        focused ? "top-2" : "top-[-40px]"
      )}
    >
      Skip to content
    </a>
  );
}
