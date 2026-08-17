"use client";

import { usePathname } from "next/navigation";

/**
 * The auth shell's one column, and the one place its width is decided.
 *
 * Every screen in this group is a single narrow card — except /signup,
 * which carries a brand panel beside the form (see signup-form.tsx) and
 * needs room for two tracks at desktop. A server layout cannot read the
 * pathname, so the same mechanism auth-brand.tsx already uses for its
 * back link decides the measure here: one hook, one boolean. Adding a
 * route to the group keeps the narrow default, which is the right way to
 * fail — a page that needs width will look cramped and get added here; a
 * page that got width by accident would just look sparse and ship.
 */
const WIDE_ROUTES = new Set(["/signup"]);

export default function AuthColumn({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const measure = WIDE_ROUTES.has(pathname) ? "max-w-5xl" : "max-w-md";
  return (
    <div
      className={`mx-auto flex w-full ${measure} flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12`}
    >
      {children}
    </div>
  );
}
