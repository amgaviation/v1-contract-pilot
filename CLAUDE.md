# Working agreement

## Communication

- Do not narrate work in progress. No running commentary on what you are about to do, what you are doing, or which file you are opening. Work, then report.
- Explain only after the task is complete. One report at the end, not a stream.
- Clear, concise, straight to the point. No filler, no preamble, no restating the request back.
- Do not give recommendations. Do not list options you are not taking. Pick and execute.
- Ask when the request is genuinely ambiguous. Get the answer, then execute. Do not ask about things you can determine yourself.

## What to surface

Raise only these, and raise them plainly:

- Work that will take materially more effort than the request implies.
- Anything with negative financial, legal, or security consequences.
- Manual steps required from the user. State these only after research is done, and state exactly what is needed and why.

Everything else goes in the final report or nowhere.

## Accuracy

- When uncertain about a fact, a current value, or a technical detail, search the web and verify. Do not speculate, and do not state uncertainty without first investigating.
- When the work touches a specific API, library, or SDK, read its current documentation before writing code against it. Do not rely on recall for signatures, parameter names, versions, or behaviour.
- Report outcomes as they are. If a check fails, say so and show the output. If a step was skipped, say which and why.

## Manual steps

Before asking the user to do anything by hand:

1. Finish the research and read the relevant documentation.
2. Confirm their specific setup and use case if it is not already known.
3. Then state precisely what you need from them.

# Model routing

Quality first. This is a high-profile product: never route work that writes code, makes decisions, or reviews output to a smaller model to save tokens. Economy comes only from the read-only path and from keeping the main context lean - which itself improves output quality.

The session default is Opus 5 (pinned in `.claude/settings.json`). Delegate via the subagents in `.claude/agents/`:

- **Searches, lookups, "where is X"** → `scout` (Haiku, read-only). Safe to run cheap: it only locates code; the main loop verifies anything load-bearing before acting on it. Never burn main-loop context reading files broadly.
- **Reviewing any non-trivial diff before commit** → `reviewer` (Opus). Review gates the product; it runs at full strength, always.
- **Hardest problems** - debugging that resisted a first attempt, cross-cutting design, migrations → `architect` (Fable, the most capable model).

All edits happen in the main loop at full capability with full conversation context - no cheap-model write path. Keep the main context lean: delegate read-heavy work, don't re-read what a subagent already summarized.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
