import type { MetadataRoute } from "next";

/**
 * Only "/" and "/pricing" are indexable — see app/(marketing)/layout.tsx.
 * /terms and /privacy carry their own noindex (counsel-gated placeholders
 * that say so in their own bodies) and are intentionally left off this
 * list.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return [
    { url: baseUrl },
    { url: `${baseUrl}/pricing` },
  ];
}
