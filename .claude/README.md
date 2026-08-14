# Claude Code configuration

## Skills

`.claude/skills/` holds skills vendored from [Armory](https://github.com/Mathews-Tom/armory)
via the Skills CLI. They load automatically for anyone running Claude Code in this
repo — no per-developer setup.

Installed (a curated subset of Armory's 82 skills, chosen for this Next.js /
TypeScript / Supabase codebase):

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

### Updating

```bash
npx skills update --project
```

### Adding more Armory skills

```bash
npx skills add Mathews-Tom/armory -s <skill-name> -a claude-code --copy -y
```

Pass `-s` once per skill (comma-separated lists are not parsed). Browse the full
catalogue with `npx skills add Mathews-Tom/armory --list`.

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
