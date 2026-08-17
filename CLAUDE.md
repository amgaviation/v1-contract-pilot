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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
