"use client";

import { useMemo, useState } from "react";
import NextLink from "next/link";
import { LCard } from "@/components/ledger";
import { LInput } from "@/components/ledger/forms";
import { HELP_SECTIONS, searchHelpSections } from "@/lib/help/guide";

/**
 * The guide, with the search over it.
 *
 * CLIENT-SIDE FILTERING, deliberately. The whole guide is a few kilobytes
 * of static text that ships with the page anyway, so filtering it in the
 * browser costs one array pass per keystroke and returns results with no
 * round trip. A server round trip per keystroke would be slower, would need
 * debouncing, and would put a spinner between a pilot and an answer they are
 * looking up precisely because something is confusing them.
 *
 * The content itself lives in lib/help/guide.ts as plain data, so the search
 * is a pure function that is tested without a renderer.
 */
export default function HelpBrowser() {
  const [query, setQuery] = useState("");

  // Recomputed only when the query changes, not on every render.
  const sections = useMemo(() => searchHelpSections(query), [query]);
  const total = useMemo(
    () => sections.reduce((n, section) => n + section.topics.length, 0),
    [sections]
  );
  const searching = query.trim().length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* The search sits at the top and takes focus on load: someone who
          opened Help has a question already, and making them click the box
          first is a step for nothing. */}
      <div className="flex flex-col gap-2">
        <LInput
          className="h-11 text-lead"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search: invoices, mileage, day types, tail numbers…"
          aria-label="Search the guide"
          type="search"
        />
        {/* Announced, not just shown: a screen-reader user typing into the
            box otherwise gets no feedback that the list below changed. */}
        <p className="text-caption text-ink-3" role="status" aria-live="polite">
          {searching
            ? `${total} ${total === 1 ? "result" : "results"} for “${query.trim()}”`
            : `${total} topics`}
        </p>
      </div>

      {sections.length === 0 ? (
        <LCard className="flex flex-col gap-2">
          <p className="text-body-s text-ink">Nothing in the guide matches that.</p>
          <p className="text-caption text-ink-3">
            Try a single word: the name of a screen, or the thing you are looking
            at. Every word you type has to appear somewhere in a topic for it to
            show.
          </p>
        </LCard>
      ) : (
        sections.map((section) => (
          <div key={section.id} className="flex flex-col gap-3">
            <h2 className="text-h3 font-semibold text-ink">{section.title}</h2>

            {section.topics.map((topic) => (
              <LCard key={topic.id} id={topic.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-lead font-semibold text-ink">{topic.title}</h3>
                  {/* The guide's job is to end with the pilot on the screen
                      they were asking about, not with them navigating back
                      to find it. */}
                  {topic.href ? (
                    <NextLink
                      href={topic.href}
                      className="text-caption font-medium text-accent hover:underline"
                    >
                      Open
                    </NextLink>
                  ) : null}
                </div>

                <p className="text-body-s text-ink-2">{topic.summary}</p>

                {topic.body.map((paragraph, i) => (
                  <p key={i} className="text-body-s text-ink">
                    {paragraph}
                  </p>
                ))}
              </LCard>
            ))}
          </div>
        ))
      )}

      {/* Rendered only when browsing. During a search it would be one more
          thing between the query and the results. */}
      {!searching ? (
        <p className="text-caption text-ink-3">
          {HELP_SECTIONS.length} sections, {total} topics.
        </p>
      ) : null}
    </div>
  );
}
