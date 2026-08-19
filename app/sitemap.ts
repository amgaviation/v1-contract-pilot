import type { MetadataRoute } from "next";

/**
 * The four indexable marketing pages — see app/(marketing)/layout.tsx.
 * /how-it-works and /your-data joined the list at the 2026-08-19
 * restructure, when both stopped being sections of "/" and became pages.
 * /terms and /privacy carry their own noindex (counsel-gated placeholders
 * that say so in their own bodies) and are intentionally left off this
 * list.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return [
    { url: baseUrl },
    { url: `${baseUrl}/how-it-works` },
    { url: `${baseUrl}/pricing` },
    { url: `${baseUrl}/your-data` },
  ];
}
