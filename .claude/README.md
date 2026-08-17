# Claude Code configuration

## Skills

`.claude/skills/` holds skills vendored from upstream repositories via the
Skills CLI. They load automatically for anyone running Claude Code in this
repo — no per-developer setup.

**Vendor them with `--copy`.** Recent versions of the CLI default to writing
the real files into `.agents/skills/` and leaving a symlink per tool in
`.claude/skills/`. This repo does not use that layout: everything here is a
real directory, committed, so a clone works with no install step and no
symlink resolution. Running a bare `npx skills add <repo>` produces the
symlink layout and a stray `.agents/` directory; the flags in each section
below are the ones that match what is already committed.

### Engineering — Armory

From [Armory](https://github.com/Mathews-Tom/armory), a curated subset of its
82 skills chosen for this Next.js / TypeScript / Supabase codebase:

| Skill | What it does |
| --- | --- |
| `pr-review` | Diff-based review: quality, coverage, silent failures, type design |
| `pre-landing-review` | Final gate before merging |
| `code-refiner` | Complexity reduction and cleanup |
| `test-harness` | Test scaffolding and coverage work |
| `debug-investigator` | Systematic root-cause investigation |
| `architecture-reviewer` | Structural review of the codebase |
| `dependency-audit` | Dependency health and vulnerability review |
| `repo-sentinel` | Repo hygiene and secret scanning |
| `sql-optimizer` | Query plans, indexes, N+1 detection — relevant to the Supabase layer |
| `migration-risk-analyzer` | Risk review for schema migrations |
| `env-validator` | Environment variable validation |
| `ux-expert` | UX review of flows and interfaces |

### Marketing — Corey Haines

The full 49-skill set from
[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills),
installed whole rather than curated: the signed-out surface is a real product
surface with its own doc (`docs/MARKETING.md`), and the set covers it end to
end. The ones that touch what is already written down here:

| Skill | Where it applies |
| --- | --- |
| `cro` | The landing and pricing pages — `app/(marketing)/` |
| `copywriting`, `copy-editing` | Any change to public copy; read `docs/MARKETING.md` §5 first |
| `product-marketing` | Positioning and ICP — overlaps `docs/MARKETING.md` §§1–3 |
| `pricing` | Tiers and packaging — overlaps `docs/PRICING.md` |
| `signup`, `onboarding` | `app/(auth)/` and the post-checkout wizard |
| `ai-seo`, `seo-audit`, `schema` | Discoverability of the four public pages |
| `churn-prevention`, `paywalls` | Downgrade and cancel paths — see `docs/PLAN-GATES.md` |

**These skills do not know this product's claim rules.** They are general
SaaS marketing skills and will happily suggest copy that `docs/MARKETING.md`
§5 forbids: testimonials and invented statistics (rule 8), tax-outcome
claims (rule 10), urgency and scarcity language, or anything implying the
product decides whether a pilot is legal to fly (rule 4). `docs/MARKETING.md`
and the `aviation-expert` skill outrank them on every public string. Treat
their output as a draft to be checked, not copy to be shipped.

### Updating

```bash
npx skills update --project
```

### Adding more skills

```bash
npx skills add <owner>/<repo> -s <skill-name> -a claude-code --copy -y
```

Pass `-s` once per skill (comma-separated lists are not parsed), or omit it to
take the whole set. `--copy -a claude-code` is not optional here — see the note
at the top about the symlink layout the bare command produces. Browse a
catalogue with `npx skills add <owner>/<repo> --list`.

`skills-lock.json` at the repo root pins the installed set — commit it alongside
any change here.

### Why not the plugin marketplace?

Armory also publishes itself as a Claude Code plugin
(`claude plugin marketplace add Mathews-Tom/armory`). That route currently fails
to load on Claude Code 2.1.231: Armory's `plugin.json` declares its agents and
commands as glob paths (`./agents/*/AGENT.md`), which the CLI resolves literally
rather than expanding, so the plugin errors with `Path not found`. The Skills CLI
route above is unaffected. Revisit the plugin route once that is fixed upstream —
it would additionally bring Armory's agents, commands, hooks, and rules, which
this install does not include.
