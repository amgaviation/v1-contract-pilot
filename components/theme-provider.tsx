"use client";

import { ThemeProvider } from "@mui/material/styles";
import type { ReactNode } from "react";
import { theme } from "@/lib/theme";

/**
 * Client boundary for MUI's ThemeProvider (MUI relies on Emotion's
 * context, which App Router server components cannot render).
 *
 * Deliberately NOT rendering <CssBaseline>: app/base.css already governs
 * the document ground (the ambient radial wash, focus ring, selection,
 * box-sizing) and CssBaseline's own body/background reset would fight it
 * — the two resets disagree on where color-scheme and background come
 * from. This wrapper exists purely so MUI-based components (new template
 * pages) pick up the shared palette in lib/theme.ts, without touching how
 * the existing .v1-* system paints the page.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme} disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}
