# Vendored font files

The three faces INSTRUMENT uses, checked in rather than downloaded at build
time. `lib/fonts.ts` loads them with `next/font/local`; nothing else should
reference them directly.

## Why these are in the repo

They used to come from `next/font/google`, which self-hosts the result but
fetches the files from `fonts.gstatic.com` **during the build**. That made
every production build depend on Google being reachable, and it failed exactly
that way in CI on a commit that touched no font code. A font is a static asset
that changes roughly never — fetching it on every build to render text that has
not changed buys nothing and puts a third-party outage between the team and a
deploy.

## What is here

| File | Family | Weight axis used | Source |
|---|---|---|---|
| `archivo-variable.woff2` | Archivo | 500–700 | Google Fonts, latin subset, v25 |
| `inter-variable.woff2` | Inter | 400–600 | Google Fonts, latin subset, v20 |
| `jetbrains-mono-variable.woff2` | JetBrains Mono | 400–600 | Google Fonts, latin subset, v24 |

**One file per family, not one per weight.** All three are variable fonts:
Google serves a single file covering the whole weight axis, and the several
`@font-face` blocks it emits for a multi-weight request all point at that same
file. The weight ranges in `lib/fonts.ts` select the slice to interpolate.

**Latin subset only**, matching the `subsets: ["latin"]` the previous
configuration requested.

## Licensing — read before deleting anything here

All three are licensed under the **SIL Open Font License 1.1**, which permits
redistribution and **requires the licence to accompany the font files**. The
full texts are checked in beside them:

- `LICENSE-Archivo.txt` — Copyright 2020 The Archivo Project Authors
- `LICENSE-Inter.txt` — Copyright (c) 2016 The Inter Project Authors
- `LICENSE-JetBrainsMono.txt` — Copyright 2020 The JetBrains Mono Project Authors

Those files are not clutter. They are the terms under which these bytes are
allowed to be in this repository, and under which the app is allowed to serve
them.

## Updating a face

Deliberately a manual act, which is the point — it is the same argument the
token layer makes about drift.

1. Fetch the current CSS with a modern browser User-Agent:
   `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap`
2. Take the `.woff2` URL from the block commented `/* latin */`.
3. Download it over the file here, keeping the name.
4. Re-check the licence text upstream in case it changed.
5. Say in the commit message which face moved and why.
