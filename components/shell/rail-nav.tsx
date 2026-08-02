"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "@/lib/brand";

const NAV_ITEMS = [
  { label: "Overview", href: "/" },
  { label: "Trips", href: "/trips" },
  { label: "Invoices", href: "/invoices" },
  { label: "Expenses", href: "/expenses" },
  { label: "Logbook", href: "/logbook" },
  { label: "Clients", href: "/clients" },
  { label: "Documents", href: "/documents" },
] as const;

export function RailNav({
  accountName,
  userName,
}: {
  accountName: string;
  userName: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="v1-rail">
      <div className="v1-rail-brand">
        <span className="v1-rail-wordmark">{BRAND.wordmark}</span>
        <span className="v1-rail-descriptor">{BRAND.descriptor}</span>
      </div>
      <nav className="v1-rail-nav">
        {NAV_ITEMS.map((item) => {
          // Path-prefix match, not string-prefix: pathname.startsWith("/trips")
          // would also light up for a future "/tripsheets" route and report
          // aria-current="page" on the wrong nav item.
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                isActive
                  ? "v1-rail-nav-item v1-rail-nav-item--active"
                  : "v1-rail-nav-item"
              }
              aria-current={isActive ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="v1-rail-account">
        <span className="v1-rail-account-name">{accountName}</span>
        {userName}
      </div>
    </aside>
  );
}
