"use client";

import { useState } from "react";
import { Box, Text } from "@/components/ui";

/**
 * H9: "Skip to content" — invisible until it has focus, then pinned
 * top-left above everything else. First focusable element on the page,
 * so a keyboard or screen-reader user tabbing in lands here before the
 * (now much longer, on a phone) chain of nav links.
 *
 * A tiny client component rather than a CSS class in app/globals.css:
 * that file is deliberately kept almost empty (see its own header) and
 * is shared with every other agent working on this codebase, so the
 * focus-visibility toggle lives here as component state instead of
 * adding a new global rule. Size and weight come from the Text
 * component's own props (`size`, `weight`), not spelled-out CSS, so
 * scripts/verify-tokens.mjs's rule holds here too — only position,
 * colour-via-token and the transition are plain style, and every colour
 * used is a Radix scale variable, not a literal.
 */
export default function SkipLink() {
  const [focused, setFocused] = useState(false);

  return (
    <Box
      asChild
      px="3"
      py="2"
      style={{
        position: "absolute",
        top: focused ? "8px" : "-40px",
        left: "8px",
        zIndex: 1000,
        background: "var(--accent-9)",
        borderRadius: "var(--radius-2)",
        transition: "top 0.15s ease-in-out",
      }}
    >
      <a
        href="#main-content"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ textDecoration: "none" }}
      >
        <Text size="2" weight="medium" style={{ color: "var(--accent-contrast)" }}>
          Skip to content
        </Text>
      </a>
    </Box>
  );
}
