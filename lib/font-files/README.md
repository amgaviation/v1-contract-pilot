# Vendored font files

The one face LEDGER uses, checked in rather than downloaded at build time.
`lib/fonts.ts` loads it with `next/font/local`; nothing else should reference
it directly.

## Why this is in the repo

It used to come from `next/font/google`, which self-hosts the result but
fetches the files from `fonts.gstatic.com` **during the build**. That made
every production build depend on Google being reachable, and it failed exactly
that way in CI on a commit that touched no font code. A font is a static asset
that changes roughly never — fetching it on every build to render text that has
not changed buys nothing and puts a third-party outage between the team and a
deploy.

## What is here

| File | Family | Weight axis used | Source |
|---|---|---|---|
| `schibsted-grotesk-variable.woff2` | Schibsted Grotesk | 400–700 | Google Fonts, latin subset |

**One file, not one per weight.** It is a variable font: Google serves a
single file covering the whole weight axis, and the several `@font-face`
blocks it emits for a multi-weight request all point at that same file. The
weight range in `lib/fonts.ts` selects the slice to interpolate.

**Latin subset only**, matching the `subsets: ["latin"]` a `next/font/google`
configuration would have requested.

## Licensing — read before deleting anything here

Licensed under the **SIL Open Font License 1.1**, which permits redistribution
and **requires the licence to accompany the font file**. The full text is
checked in beside it:

- `LICENSE-SchibstedGrotesk.txt` — Copyright 2022 The Schibsted Grotesk Project Authors

That file is not clutter. It is the terms under which these bytes are allowed
to be in this repository, and under which the app is allowed to serve them.

## Updating the face

Deliberately a manual act, which is the point — it is the same argument the
token layer makes about drift.

1. Fetch the current CSS with a modern browser User-Agent:
   `https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&display=swap`
2. Take the `.woff2` URL from the block commented `/* latin */`.
3. Download it over the file here, keeping the name.
4. Re-check the licence text upstream in case it changed.
5. Say in the commit message which face moved and why.
