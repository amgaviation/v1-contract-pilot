# Vendored font files

The three faces LEDGER uses, checked in rather than downloaded at build
time. `lib/fonts.ts` loads them with `next/font/local`; nothing else should
reference them directly.

## Why these are in the repo

Two separate reasons, and the second is the one that will bite if it is
forgotten.

**A build must not depend on a third party.** These used to come from
`next/font/google`, which self-hosts the result but fetches the files from
`fonts.gstatic.com` **during the build**. That made every production build
depend on Google being reachable, and it failed exactly that way in CI on a
commit that touched no font code.

**The Google Fonts CDN strips OpenType features.** The woff2 subsets served
from `fonts.gstatic.com` can arrive without the `tnum`, `zero`, `case` and
`frac` features the upstream files carry. This product puts money and flight
times in columns and switches on tabular figures with the `tnum-l` utility,
so a face that quietly lost `tnum` would misalign every invoice table with
nothing failing anywhere: no error, no warning, just columns that jitter.
**Take new faces from the `google/fonts` repository, not the CDN**, and
check the feature list after subsetting (below).

## What is here

| File | Family | Axis kept | Job |
|---|---|---|---|
| `schibsted-grotesk-variable.woff2` | Schibsted Grotesk | `wght` 400–700 | `font-ledger` — the interface, every product screen |
| `archivo-semiexpanded-variable.woff2` | Archivo | `wght` 400–800, `wdth` pinned at 112 | `font-display` — headlines on the signed-out surface |
| `azeret-mono-variable.woff2` | Azeret Mono | `wght` 400–700 | `font-mono` — tail numbers, airport identifiers, eyebrows |

**Variable files, one per family, not one per weight.** The weight range in
`lib/fonts.ts` selects the slice to interpolate.

**Latin subset only.** Archivo's width axis is *pinned*, not shipped:
nothing on the surface varies width, so carrying the axis would be dead
weight, and pinning it holds the file at 33KB.

Archivo and Azeret Mono are loaded with `preload: false`. They render on
four public pages; preloading them would make every authenticated screen
pay for bytes it never draws.

## Licensing — read before deleting anything here

All three are licensed under the **SIL Open Font License 1.1**, which
permits redistribution and **requires the licence to accompany the font
file**. The full texts are checked in beside them:

- `LICENSE-SchibstedGrotesk.txt` — Copyright 2022 The Schibsted Grotesk Project Authors
- `LICENSE-Archivo.txt` — Copyright 2020 The Archivo Project Authors
- `LICENSE-AzeretMono.txt` — Copyright 2021 The Azeret Project Authors

Those files are not clutter. They are the terms under which these bytes are
allowed to be in this repository, and under which the app is allowed to
serve them.

## Adding or updating a face

Deliberately a manual act, which is the point: it is the same argument the
token layer makes about drift.

1. Take the source from `https://github.com/google/fonts` (`ofl/<family>/`),
   **not** from `fonts.googleapis.com`. Take its `OFL.txt` in the same step.
2. Subset to latin and, if the family has axes you do not need, pin them.
   `fontTools` does both; keep `tnum`, `zero`, `kern`, `liga`, `ccmp`,
   `locl`, `mark`, `mkmk`, `calt`, `rvrn`, `case` and `frac` in
   `layout_features`, and omit `U+FEFF` from the unicode set (it has no
   rendered form and trips `gvar` subsetting).
3. **Verify the features survived**, because this is the failure mode that
   is otherwise silent:

   ```python
   from fontTools.ttLib import TTFont
   f = TTFont("lib/font-files/<file>.woff2")
   feats = {r.FeatureTag
            for t in ("GSUB", "GPOS") if t in f
            for r in f[t].table.FeatureList.FeatureRecord}
   print("tnum" in feats, "zero" in feats)
   ```

4. Wire it in `lib/fonts.ts` (`src`, `weight`, `variable`) and add the
   matching `--font-*` line to `app/design/ledger.css`'s `@theme inline`.
   Keep the `variable:` name in step across both files:
   `scripts/verify-tokens.mjs` reads it out of `lib/fonts.ts` by regex to
   build its declared-token set, so a rename in one place and not the other
   fails as a dead token reference rather than silently falling back.
5. Re-check the licence text upstream in case it changed.
6. Say in the commit message which face moved and why.
