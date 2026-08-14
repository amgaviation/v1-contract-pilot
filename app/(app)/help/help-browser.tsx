"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Box, Card, Flex, Heading, Text, TextField } from "@/components/ui";
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
    <Flex direction="column" gap="5">
      {/* The search sits at the top and takes focus on load: someone who
          opened Help has a question already, and making them click the box
          first is a step for nothing. */}
      <Flex direction="column" gap="2">
        <TextField.Root
          size="3"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search — invoices, mileage, day types, tail numbers…"
          aria-label="Search the guide"
          type="search"
        />
        {/* Announced, not just shown: a screen-reader user typing into the
            box otherwise gets no feedback that the list below changed. */}
        <Text size="1" color="gray" role="status" aria-live="polite">
          {searching
            ? `${total} ${total === 1 ? "result" : "results"} for “${query.trim()}”`
            : `${total} topics`}
        </Text>
      </Flex>

      {sections.length === 0 ? (
        <Card>
          <Flex direction="column" gap="2" p="1">
            <Text size="2">Nothing in the guide matches that.</Text>
            <Text size="1" color="gray">
              Try a single word — the name of a screen, or the thing you are looking
              at. Every word you type has to appear somewhere in a topic for it to
              show.
            </Text>
          </Flex>
        </Card>
      ) : (
        sections.map((section) => (
          <Flex key={section.id} direction="column" gap="3">
            <Heading as="h2" size="3">
              {section.title}
            </Heading>

            {section.topics.map((topic) => (
              <Card key={topic.id} id={topic.id}>
                <Flex direction="column" gap="2" p="1">
                  <Flex justify="between" align="baseline" gap="3" wrap="wrap">
                    <Heading as="h3" size="4">
                      {topic.title}
                    </Heading>
                    {/* The guide's job is to end with the pilot on the screen
                        they were asking about, not with them navigating back
                        to find it. */}
                    {topic.href ? (
                      <Link href={topic.href}>
                        <Text size="1">Open</Text>
                      </Link>
                    ) : null}
                  </Flex>

                  <Text size="2" color="gray">
                    {topic.summary}
                  </Text>

                  {topic.body.map((paragraph, i) => (
                    <Text key={i} size="2" as="p">
                      {paragraph}
                    </Text>
                  ))}
                </Flex>
              </Card>
            ))}
          </Flex>
        ))
      )}

      {/* Rendered only when browsing. During a search it would be one more
          thing between the query and the results. */}
      {!searching ? (
        <Box>
          <Text size="1" color="gray">
            {HELP_SECTIONS.length} sections, {total} topics.
          </Text>
        </Box>
      ) : null}
    </Flex>
  );
}
