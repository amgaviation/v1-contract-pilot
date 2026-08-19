"use client";

import * as React from "react";
import { cn } from "@/lib/ledger/cn";

/**
 * The marketing surface's entry-motion primitive: a block that fades and
 * rises the first time it enters the viewport. One IntersectionObserver
 * per instance, disconnected after the first hit — this animates entry,
 * it does not track scroll.
 *
 * The hidden initial state lives in app/design/marketing.css behind
 * @media (scripting: enabled), so a no-JS visitor gets a fully visible
 * page — this component only ever ADDS visibility, never takes it away.
 * Reduced motion is handled there too (content shown, movement dropped);
 * the observer still runs but flips an attribute the CSS ignores.
 *
 * `delay` maps to the .mkt-d* stagger classes rather than an inline
 * transition-delay literal, keeping every timing value in the sheet.
 */
export default function Reveal({
  children,
  className,
  delay,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  /** Stagger step: 1 = 90ms, 2 = 180ms, 3 = 270ms. */
  delay?: 1 | 2 | 3;
  as?: "div" | "section" | "li" | "figure";
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  return (
    <Tag
      // React types the ref per-tag; one mutable HTMLElement ref serves
      // all four variants.
      ref={ref as React.Ref<never>}
      data-shown={shown}
      className={cn(
        "mkt-reveal",
        delay === 1 && "mkt-d1",
        delay === 2 && "mkt-d2",
        delay === 3 && "mkt-d3",
        className
      )}
    >
      {children}
    </Tag>
  );
}
