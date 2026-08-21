# Prompt-Engineering Audit — Repo's Own Agent/Skill Prompt Surface

**Scope:** `CLAUDE.md`, `.claude/agents/{engineer,coder,reviewer}.md`, `.claude/commands/full-audit.md`,
`.claude/README.md`, `.claude/settings.json`. Treated as prompts, not application code. Twelve
findings below, ranked most severe first, each grounded in a file actually opened this run.
The headline: the routing boundary between `engineer` and `coder` is undermined by a genuine
word collision on "ledger" that points the two agents at each other's territory, and every
enforcement mechanism named "mandatory" in prose (the reviewer gate, the coder hard-boundary,
the verify table) has no hook or tool restriction behind it — an agent that skips the prose
is not stopped by anything mechanical except `reviewer.md`'s own `tools:` list.

---

## Findings

### 1. [High] "ledger" names two unrelated things, and it sits exactly on the engineer/coder boundary

**Location:** `CLAUDE.md:41-42`, `.claude/agents/coder.md:3,20`, `.claude/agents/engineer.md:3`

`CLAUDE.md:41` puts "ledger" inside the engineer's money-paths parenthetical: *"money paths
(`lib/stripe/`, `lib/autopay/`, invoicing/payments, bank import, ledger)"*. `CLAUDE.md:42` then
tells coder to handle *"UI/LEDGER"* work, and `coder.md:20` spells out that LEDGER is "styling
... tokens from `app/design/ledger.css` via `components/ledger/` primitives" — a design system,
not accounting.

I verified both referents exist and are disjoint:

- `lib/ledger/` on disk contains exactly one file, `lib/ledger/cn.ts` — a `clsx`/`tailwind-merge`
  class combiner whose own doc-comment says *"Ledger's class combiner ... for Ledger components
  only"*. This is the coder-owned UI system, not a money path.
- The actual double-entry accounting ledger — `pilot.journal_entry_create`, balance postings —
  lives in `app/(app)/accounting/journal/actions.ts` and `app/(app)/accounting/ledger-lib.ts`.
  Neither path is named anywhere in `CLAUDE.md`, `engineer.md`, or `coder.md`.

So the one file path that literally contains the string "ledger" (`lib/ledger/cn.ts`) is
explicitly coder's, while the money-relevant accounting ledger has *no* explicit path anchor in
either agent's routing text — it's covered only by the same ambiguous word. A coordinator
routing "add a running balance column to the accounting ledger page" has to already know the
codebase well enough to disambiguate a term the routing document itself uses inconsistently.
That defeats the purpose of having a routing table.

**Fix** — stop overloading the word; name the real paths in both documents:

```diff
- money paths (`lib/stripe/`, `lib/autopay/`, invoicing/payments, bank import, ledger)
+ money paths (`lib/stripe/`, `lib/autopay/`, invoicing/payments, bank import,
+   the accounting ledger under `app/(app)/accounting/**` and `pilot.journal_entry_create`)
```

```diff
- **`coder` (Sonnet)** - only under explicit coordinator direction, for well-scoped routine
- work: UI/LEDGER, ordinary feature code, fixes.
+ **`coder` (Sonnet)** - only under explicit coordinator direction, for well-scoped routine
+ work: UI and the LEDGER *design system* (`app/design/ledger.css`, `components/ledger/`,
+ `lib/ledger/cn.ts` — capitalized "LEDGER" always means this, never the accounting ledger),
+ ordinary feature code, fixes.
```

---

### 2. [High] The reviewer gate is enforced by nothing but agreement to run it

**Location:** `CLAUDE.md:43` ("mandatory before EVERY push. No diff reaches GitHub without its
PASS."), `.claude/agents/reviewer.md:1-23`, `.claude/settings.json:1-22`

`settings.json`'s only hooks are two `SessionStart` commands (Postgres bootstrap, `npm ci`).
There is no `PreToolUse` hook on `Bash` matching `git push`, so nothing stops the coordinator
(or any subagent with Bash) from pushing directly. "Mandatory" and "No diff reaches GitHub
without its PASS" describe an intent the coordinator can simply not act on — the enforcement is
entirely social, resting on the coordinator choosing to invoke `reviewer` and then choosing to
honor its verdict.

**Fix** — add a `PreToolUse` hook gating `git push`:

```json
"PreToolUse": [
  {
    "matcher": "Bash",
    "hooks": [
      {
        "type": "command",
        "command": "cmd=$(cat); echo \"$cmd\" | grep -qE '\\bgit push\\b' || exit 0; [ -f /var/tmp/v1-reviewer-pass ] && [ \"$(cat /var/tmp/v1-reviewer-pass)\" = \"$(git rev-parse HEAD)\" ] && exit 0; echo 'reviewer PASS required for this commit before push (see CLAUDE.md verify gate)' >&2; exit 2"
      }
    ]
  }
]
```
with `reviewer.md` instructed to write `git rev-parse HEAD > /var/tmp/v1-reviewer-pass` only on
a clean PASS. This is the smallest change that turns "mandatory" from prose into something a
hook can actually block on.

---

### 3. [High] coder's hard boundary is prose only — no tool restriction backs it

**Location:** `.claude/agents/coder.md:1-25` vs `.claude/agents/reviewer.md:5`

`reviewer.md` frontmatter restricts its own tools to `Read, Glob, Grep, Bash` — it *cannot* Edit
or Write, so it structurally cannot violate "report only." `engineer.md` and `coder.md` both omit
a `tools:` line entirely, meaning both get the full default toolset including Edit/Write/Bash.
coder's entire boundary — "Hard boundary - if the task requires touching any of these, STOP and
hand it back instead of editing" (`coder.md:9`) — is therefore self-enforced: nothing prevents
coder from opening `lib/stripe/webhook.ts` and editing it if it decides (or is told, or
hallucinates its way into believing) that's in scope. Given that `coder` runs on Sonnet against
a codebase whose CLAUDE.md itself says "No Haiku anywhere ... [because] this product moves real
money," leaving its highest-stakes boundary unenforced is the one guardrail gap most worth
closing mechanically.

**Fix** — the cleanest lever available today is a settings-level deny list scoped to when the
`coder` subagent is active (Claude Code supports per-tool `permissions.deny` glob patterns); at
minimum, add an explicit note in `coder.md` that this is a *known, currently-unenforced* gap so
the coordinator treats coder's self-report skeptically rather than as a guarantee:

```diff
  Hard boundary - if the task requires touching any of these, STOP and hand it back instead of editing:
+ (Note: this boundary is not tool-enforced. Nothing blocks Edit/Write on these paths if this
+ agent decides to. The coordinator must not treat "coder finished" as proof these paths were
+ untouched — check the diff.)
```

---

### 4. [Medium] `.claude/README.md`'s Armory table names 5 skills that are not on disk; skills-lock.json tracks 73 of the 110 directories that actually exist

**Location:** `.claude/README.md:24-36`, `skills-lock.json`, `.claude/skills/` (110 directories)

Verified directly:

```
$ for n in pr-review pre-landing-review test-harness debug-investigator migration-risk-analyzer; do
    [ -d ".claude/skills/$n" ] && echo PRESENT || echo MISSING; done
pr-review: MISSING
pre-landing-review: MISSING
test-harness: MISSING
debug-investigator: MISSING
migration-risk-analyzer: MISSING
```

All five are listed in the README's Armory table (`.claude/README.md:24,25,27,28,33`) as part of
the curated engineering set, and all five *are* present as provenance entries in
`skills-lock.json` (source `Mathews-Tom/armory`, with computed hashes) — meaning they were
installed and locked at some point, then deleted from disk without the lock file or the README
being updated. Any agent told to "load the `pr-review` skill" per the README will fail silently
or hallucinate a location.

Separately, and larger: `.claude/skills/` holds **110** directories, but `skills-lock.json` has
provenance for only **73** names, and the two sets diverge heavily — 37 on-disk directories
(`angular-architect`, `atlassian-mcp`, `chaos-engineer`, `cli-developer`, `cloud-architect`,
`code-documenter`, `code-reviewer`, `cpp-pro`, `csharp-developer`, `database-optimizer`,
`debugging-wizard`, `devops-engineer`, `django-expert`, `golang-pro`, `java-architect`,
`kotlin-specialist`, `rust-engineer`, and more) have no lock entry at all. `README.md:5-7` states
"`.claude/skills/` holds skills vendored from upstream repositories via the Skills CLI ... no
per-developer setup" and `README.md:80-81` says "`skills-lock.json` ... pins the installed set —
commit it alongside any change here." Neither claim matches disk: the README documents two
curated sets (a 12-skill Armory subset, a 49-skill Corey Haines set) totaling 61 skills, but 110
exist, with unexplained provenance for the other ~49 (`debugging-wizard` in particular looks like
a same-purpose replacement for the missing `debug-investigator`, but nothing says so).

**Fix** — this is a documentation/process gap, not a prompt-wording one, but it directly affects
prompt reliability: any skill reference in `README.md`, `CLAUDE.md`, or `full-audit.md` should be
treated as unverified until `skills-lock.json` and `.claude/skills/` are reconciled. Concretely:
regenerate `skills-lock.json` from what's actually on disk (or delete the untracked directories
if they're not meant to be there), and strike the 5 dead rows from the README table.

---

### 5. [Medium] coder's payment-logic exclusion inside `app/(app)/invoices/actions.ts` is undecidable at the function level

**Location:** `.claude/agents/coder.md:15` ("Payment/issuance logic in `app/(app)/invoices/actions.ts` and `app/(app)/estimates/actions.ts`")

`app/(app)/invoices/actions.ts` is a single ~2,530-line file exporting at least a dozen server
actions, confirmed by grep:

```
createInvoiceDraft, updateInvoiceHeader, updateInvoiceNotes, sendInvoice, sendInvoiceReminder,
voidInvoice, addInvoiceLine, addRebillExpenseLine, updateInvoiceLine, deleteInvoiceLine,
recordPayment, correctPayment
```

`coder.md` bars only *"Payment/issuance logic"* within this file — not the whole file — but
gives no rule for classifying the individual exports. `recordPayment`/`correctPayment` are
obviously payment logic; `sendInvoice`/`voidInvoice` drive `invoices_protect_issued`, the
forward-only status machine `engineer.md:12` calls out as an invariant — clearly engineer's, but
not named as such. `updateInvoiceNotes` (editing a text field) is clearly coder's. Where does
`addRebillExpenseLine` (adds a billable line item, touches totals) fall? The document offers no
test — the coordinator (or coder itself, deciding whether to "hand it back") has to make a
domain judgment about whether a given function changes money state, which is exactly the
judgment coder is supposed to be barred from making unsupervised.

**Fix** — replace the function-blind file reference with an explicit function list, and default
unlisted exports to engineer:

```diff
- Payment/issuance logic in `app/(app)/invoices/actions.ts` and `app/(app)/estimates/actions.ts`
+ In `app/(app)/invoices/actions.ts` / `app/(app)/estimates/actions.ts`: any function whose body
+ writes `status`, `amount_cents`, calls Stripe, or inserts into a payments/ledger table
+ (currently: sendInvoice, sendInvoiceReminder, voidInvoice, recordPayment, correctPayment,
+ addRebillExpenseLine, and their estimate equivalents). Anything else in these two files —
+ label edits, note fields, header metadata — is coder's. If a task's target function isn't on
+ this list and you can't tell from its body alone whether it writes money state, hand it back
+ rather than guessing.
```

---

### 6. [Medium] engineer.md and reviewer.md assert Postgres availability as fact; the guarantee is actually conditional and the qualifier is dropped

**Location:** `.claude/settings.json:10`, `CLAUDE.md:47`, `.claude/agents/engineer.md:17`, `.claude/agents/reviewer.md:21`

The SessionStart hook that boots Postgres on `127.0.0.1:55432` starts with
`[ -n "$CLAUDE_CODE_REMOTE" ] || exit 0` (`settings.json:10`) — it only runs in cloud/remote
sessions. `CLAUDE.md:47` correctly scopes this: *"Cloud sessions auto-start Postgres 16 on
127.0.0.1:55432 ... via the SessionStart hook."* But `engineer.md:17` says flatly *"Postgres is
on 127.0.0.1:55432"* and `reviewer.md:21` says the same, with no conditional. An agent running in
a local, non-remote session that follows either agent prompt literally will assume the DB verify
suites are runnable and either get a confusing connection-refused failure or (worse) silently
skip the DB checks without flagging that the precondition CLAUDE.md documented wasn't met.

**Fix:**
```diff
- Before returning: run `npm test`, plus the DB verify suites mapped to what you touched (see
- CLAUDE.md's verify map; Postgres is on 127.0.0.1:55432).
+ Before returning: run `npm test`, plus the DB verify suites mapped to what you touched (see
+ CLAUDE.md's verify map). Postgres on 127.0.0.1:55432 is only guaranteed in cloud/remote
+ sessions (CLAUDE_CODE_REMOTE set) via the SessionStart hook — `pg_isready -h 127.0.0.1 -p
+ 55432` before assuming it's up; if it isn't, say so explicitly rather than skipping the DB
+ suites silently.
```

---

### 7. [Low] `.claude/commands/full-audit.md:5` opens with a bare, undocumented token: `ultracode`

**Location:** `.claude/commands/full-audit.md:5`

The file's first line of actual content (after frontmatter) is the standalone word `ultracode`.
It is not a recognized Claude Code directive, is not referenced or defined anywhere else in the
repo (`grep -rn "ultracode"` across `*.md` returns only this one line), and has no comment
explaining its purpose. It reads like a typo or leftover for an "ultrathink"-style extended-
reasoning cue that either never landed correctly or is dead weight the model has to interpret
(and likely ignore, unpredictably) on every invocation of a 13-agent, multi-phase audit command.
An orphaned directive at the very top of a prompt is worse than no directive: it forces every
model reading the file to guess whether it's load-bearing.

**Fix** — either remove the line, or replace it with the real intended instruction, e.g.:
```diff
- ultracode
-
  # Full Repo Audit — Hierarchical Agent Workflow
```

---

### 8. [Low] CLAUDE.md's Communication section is stacked negatives where positive framing would be more reliable

**Location:** `CLAUDE.md:5-9`

```
- Do not narrate work in progress. ...
- Explain only after the task is complete. ...
- Do not give recommendations. Do not list options you are not taking. Pick and execute.
```
Four of five bullets are phrased as prohibitions. Models generally follow "do X" more reliably
than "don't do Y" (the failure mode is doing Y anyway, having attended to the object of the
negation rather than its negation) — this repo's own `prompt-engineer` skill file exists to teach
that distinction. This is low severity because the current phrasing is short and the domain is
low-stakes (communication style, not money/tenancy), but it's an easy, free improvement and it's
the one place in this audit's scope where the skill's own subject matter applies to the document
being audited.

**Fix:**
```diff
## Communication

- Do not narrate work in progress. No running commentary on what you are about to do, what you
- are doing, or which file you are opening. Work, then report.
- Explain only after the task is complete. One report at the end, not a stream.
+ Work silently, then report once at the end. Report format: what changed, what you verified,
+ what's left — no play-by-play before that.
- Clear, concise, straight to the point. No filler, no preamble, no restating the request back.
- Do not give recommendations. Do not list options you are not taking. Pick and execute.
+ Pick the best option and execute it directly; state the choice made, not the alternatives
+ considered.
```

---

### 9. [Low] No shared structured-output contract across engineer/coder/reviewer's sign-off reports

**Location:** `.claude/agents/engineer.md:17`, `.claude/agents/coder.md:25`, `.claude/agents/reviewer.md:23`

`reviewer.md:23` defines an explicit verdict format: *"Verdict: PASS, or findings as `file:line` +
defect + concrete failure scenario."* `engineer.md:17` only says *"Report results as they are -
failures verbatim, never summarized away"* (no shape). `coder.md:25` says *"Report files changed
and check results, one line each"* (a different, looser shape again). Because the coordinator has
to parse three different ad hoc report formats to decide whether a diff is push-ready, this adds
avoidable friction and risk of misreading a subagent's report as a pass when it wasn't one —
particularly for `engineer`, the agent touching the highest-stakes paths, whose report format is
the least specified of the three.

**Fix** — give engineer and coder the same kind of terse, parseable contract reviewer already
has:
```diff
# engineer.md, end of file
- Before returning: run `npm test`, plus the DB verify suites mapped to what you touched ...
- Report results as they are - failures verbatim, never summarized away.
+ Before returning: run `npm test`, plus the DB verify suites mapped to what you touched ...
+ Report as: `Files changed: <list>. Verify: <suite> PASS/FAIL (verbatim failure output if FAIL).
+ Open questions/handoffs: <none, or what needs engineer/coordinator follow-up>.`
```

---

### 10. [Low] full-audit.md's per-auditor cap and the coordinator's own cap are stated once, at different scopes, with no reconciliation rule

**Location:** `.claude/commands/full-audit.md:28` ("Cap at the 12 strongest findings" — per auditor) vs `:41` (coordinator synthesizes "all surviving findings" with no cap)

Six auditors capped at 12 each means up to 72 findings can survive verification and reach
Phase 4, where the coordinator is told to "Produce ... all surviving findings ranked by verified
severity" — no cap, no dedupe rule for two dimensions hitting the same file:line (e.g. `postgres`
and `security` both flagging the same missing RLS policy), even though the same paragraph
mentions "cross-cutting themes where several dimensions hit the same root cause" as a *separate*
deliverable. It's not contradictory, but it leaves the final report's length and structure
under-specified for a command whose own framing ("13 agents") suggests it was designed for a
predictable, bounded output.

**Fix:** add one line: *"Findings that name the same `file:line` across two or more dimensions
are merged into one entry (list every dimension that flagged it) before ranking, not duplicated
in both the ranked list and the cross-cutting-themes section."*

---

### 11. [Info] CLAUDE.md gives no criterion for "moderate" (engineer) vs "extreme" (coordinator personally) beyond an example

**Location:** `CLAUDE.md:39`

*"the main conversation is the coordinator. It plans, decomposes, delegates, and personally
implements only the extreme problems - cross-cutting design, debugging that resisted a first
attempt, anything where a wrong approach is expensive to unwind."* This is a real fuzzy boundary
(coordinator vs. engineer, not engineer vs. coder, which is the crisply-enumerated one), but it's
deliberately using judgment-based criteria ("expensive to unwind") rather than a path list, which
is defensible for a boundary this hard to enumerate. Flagging as informational rather than a
finding to fix: an example or two of tasks that *did* get escalated to the coordinator would
still make this more learnable, but the current text is not contradictory, just necessarily
loose.

---

### 12. [Info] `full-audit.md`'s pre-answered architecture-reviewer context is a good pattern worth reusing elsewhere

**Location:** `.claude/commands/full-audit.md:43-55`

Not a defect — noted because it's the one place in this prompt surface that correctly handles a
known failure mode (a vendored skill's Phase 1 wants to interview a stakeholder; a subagent can't
reach one) by pre-answering the interview inline rather than leaving the auditor to either stall
or invent answers. `engineer.md`/`coder.md`/`reviewer.md` don't have an equivalent "if you hit
condition X with no way to ask, do Y" clause anywhere (e.g., what should `coder` do if it can't
tell whether a function is payment logic — see Finding 5 — beyond "hand it back," which itself
isn't spelled out mechanically: hand back *how*, to whom, in what format?). Worth using this
command's pattern as the template when tightening the agent files.

---

## What I did not cover

- Did not audit `docs/MARKETING.md` §5 claim rules or any marketing-skill prompt content — out
  of scope per the task (prompt surface only, not the marketing skill set itself).
- Did not open every one of the 110 `.claude/skills/*/SKILL.md` files to check internal quality;
  Finding 4 is about README/lock/disk drift, not the content of the skills themselves.
- Did not attempt to actually test-drive the engineer/coder boundary by running a real task
  through both agents — findings 1 and 5 are static-analysis of the routing text against real
  file contents, not an empirical trial.
- Did not review `full-audit.md`'s Phase 1 recon brief in depth (its content is a generic repo-map
  ask; nothing prompt-quality-notable there beyond what's covered above).
- Did not check whether `claude-fable-5` (the pinned coordinator model in `settings.json:2`) is a
  currently valid model identifier — outside this audit's remit and not verifiable from within
  this sandboxed run.
- Did not evaluate the 12 Armory skill *summaries* in `README.md`'s table against the skills'
  actual `SKILL.md` content for the 7 that do exist on disk (`code-refiner`, `architecture-
  reviewer`, `dependency-audit`, `repo-sentinel`, `sql-optimizer`, `env-validator`, `ux-expert`) —
  only checked presence/absence, not description accuracy.
