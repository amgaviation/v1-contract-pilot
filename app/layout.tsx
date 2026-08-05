import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import { BRAND, THEME_COLOR } from "@/lib/brand";
import { AppThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: `${BRAND.name} — ${BRAND.descriptor}`,
    template: `%s | ${BRAND.name}`,
  },
  description:
    "Log the trip once — logbook entry, invoice, and expenses all post from it. A business tool for independent contract pilots.",
  // No auth gate exists yet (Phase 1), so the Overview screen at "/" is
  // reachable by anyone and shows synthetic-but-realistic client names
  // and dollar figures. Keep this until real auth gating lands — a
  // product whose trust story is "AMG cannot see your client list"
  // should not have a search-engine-indexed page that looks exactly like
  // one.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <AppThemeProvider>{children}</AppThemeProvider>
      </body>
    </html>
  );
}
