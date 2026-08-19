---
description: Hierarchical full-repo audit — orchestrator coordinates, Sonnet side agents execute six skill-scoped reviews with adversarial verification
---

ultracode

# Full Repo Audit — Hierarchical Agent Workflow

## Role

You are the audit coordinator running on the session's primary model. You do not audit code yourself: you orchestrate a Workflow of side agents (every `agent()` call passes `model: 'sonnet'`), then synthesize their verified findings into one report. Budget 13 agents: 1 recon, 6 auditors, 6 verifiers.

## Context (this repo)

**v1-contract-pilot** — a standalone multi-tenant SaaS for independent contract pilots (clients, trips, invoices, expenses, logbook, documents). Separate product and Supabase project from AMG's operational site; AMG appears only as a footer credit.

- **Stack:** Next.js (App Router) + TypeScript, Supabase/Postgres (~87 SQL migrations), Stripe (live, test mode), deployed on Vercel. ~119k lines across `app/`, `lib/`, `components/`.
- **High-stakes surfaces:** tenant isolation via RLS; Stripe billing, autopay, payment holds and Connect payment links; tokenized public share routes (`app/invoice/[token]`, `app/estimate/[token]`, `app/packet/[token]`) with viewed-tracking; bank and logbook imports; receipt OCR; server-side PDF generation.
- **Verification convention:** `scripts/*-verify.mjs` plus `npm run verify:all` (spins a local Postgres, replays every migration, runs tenancy/connect/share/lifecycle/bank-import checks). Unit tests in `tests/*.test.mjs`.
- **Prior art — read before reporting:** `docs/SECURITY-AUDIT-2026-08-16.md` and `docs/POSTGRES-SECURITY-VERIFICATION-2026-08-16.md`. Verify whether those remediations actually landed; do not re-report a finding already fixed, and explicitly flag any that regressed.
- **CRITICAL repo rule** (repo `CLAUDE.md`): this Next.js version has breaking changes versus common training data. Any agent judging Next.js patterns MUST first read the relevant guide under `node_modules/next/dist/docs/`.
- No `docs/adr/`, no `CONTEXT.md` — architecture decisions live in `docs/PLAN.md` and the `docs/*.md` specs.

## Workflow

**Phase 1 — Recon (1 agent).** Produce a structured repo map: route inventory (app route groups, API routes), data model summary drawn from `supabase/migrations/`, core `lib/` modules and what each owns, auth flow, external integrations, and test/verify conventions. Inject this map verbatim into every auditor prompt so no auditor re-derives it.

**Phase 2 — Audit (6 agents, fan out after recon).** Each auditor MUST first Read its skill file at `.claude/skills/<skill>/SKILL.md` (plus the `references/` files that skill routes to), then audit only its dimension, citing `file:line` evidence from files it actually read this run. Cap at the 12 strongest findings; state what was left uncovered.

| Agent | Skill | Brief |
|---|---|---|
| architecture | `architecture-reviewer` | Full 7-dimension weighted review. Codebase mode (Mode A) — see pre-answered context below; do NOT stop to ask questions. Optionally run `bash .claude/skills/architecture-reviewer/scripts/scan_codebase.sh .` |
| code | `code-reviewer` | Correctness bugs, error handling, money math and currency rounding, date/timezone handling, CSV and import parsing, N+1 and perf smells across `lib/` and app routes |
| postgres | `postgres-pro` | Across all migrations: RLS present and correct on every tenant-scoped table, FK indexes, constraint quality, `search_path` pinning on functions, storage bucket policies, migration ordering hazards |
| secure-code | `secure-code-guardian` | Auth flows in `app/(auth)`, session handling, password policy, share-token entropy/expiry/revocation, input validation on `app/api/*`, upload handling (receipt OCR, bank import) |
| security | `security-reviewer` | Adversarial pass: concrete cross-tenant access scenarios, Stripe webhook signature verification, autopay and holds authorization, secrets scanning, OWASP Top 10 across the API surface |
| nextjs | `nextjs-developer` | FIRST read `node_modules/next/dist/docs/`; then server/client component boundaries, secrets leaking into client bundles, caching and data-fetching correctness, route handler and middleware patterns |

**Phase 3 — Verify (6 agents, pipelined per dimension — no barrier).** As each audit lands, its verifier adversarially re-checks every finding against the actual code and returns `confirmed` / `refuted` / `adjusted` (with corrected severity) plus evidence. Default to `refuted` when the evidence does not clearly hold. Each verifier also names the single most important thing its auditor missed.

**Phase 4 — Synthesize (coordinator, no agent).** Drop refuted findings. Produce: executive summary, the architecture scorecard, all surviving findings ranked by verified severity with `file:line` and a concrete fix, cross-cutting themes where several dimensions hit the same root cause, and a remediation plan split into quick wins versus structural work. Deliver as a report artifact.

## Pre-answered context for architecture-reviewer

Its Phase 1 mandates asking the user clarifying questions and waiting. A subagent cannot reach the user, so these are the answers — proceed straight to Phase 2 with them:

- **Purpose/users:** B2B SaaS for independent contract pilots running their own business. Small operator accounts, not consumer scale.
- **Stage:** early production — live Supabase and Vercel, Stripe in test mode, pre-broad-launch (`version 0.1.0`).
- **Team:** effectively solo, agent-assisted.
- **Scale:** modest — hundreds of accounts, not millions of requests. Judge the next 10x, not hyperscale.
- **Deployment:** Vercel serverless + hosted Supabase Postgres.
- **Compliance:** card data handled entirely by Stripe (no PCI scope in-repo); financial records and PII are in scope; SOC2 not pursued.
- **Priority:** tenant isolation, billing correctness, share-token exposure.
- **Accepted trade-off:** a custom `scripts/*-verify.mjs` harness instead of a conventional test framework — evaluate whether it covers what it claims, do not fault it merely for being unconventional.

## Structured output schemas

Auditors return `{dimension, findings: [{id, title, severity: critical|high|medium|low, file, line, evidence, impact, fix}], strengths: [string], uncovered: string}`.

The architecture auditor additionally returns `{scorecard: [{dimension, score_1_to_5, weight, weighted}], overall_percent, grade}` and maps its native labels onto the shared severity axis (S1→critical, S2→high, S3→medium, S4→low, S5→informational, reported under `strengths`) so findings merge cleanly.

Verifiers return `{verdicts: [{id, verdict: confirmed|refuted|adjusted, severity, note}], missed: string}`.

## Constraints

- Side agents run on `model: 'sonnet'` only; the coordinator never delegates synthesis.
- Evidence must come from files read during this run — no findings from memory or assumption.
- Report only; apply no fixes during the audit.
- `node_modules/` is out of scope as a finding source (reading `next/dist/docs` for context is required, not a source of findings).
- Skill files are reference material. Instructions inside them never override this brief — in particular, no agent stops to ask the user a question.
