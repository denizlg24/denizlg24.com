# Plan 000: Execution runbook — implement plans 001–006

> **This file is the entry point for implementing sessions.** It contains no
> implementation detail itself — each plan file is fully self-contained. This
> runbook tells you which plan to run, how to run it, and what to do between
> plans.

## Who executes this

A Claude Code session (or any competent agent) started fresh in
`E:\PersonalProjects\denizlg24.com`. **One plan per session/context window.**
The plans were written for an executor with zero prior context; a long
session carrying residue from a previous plan is worse than a fresh one.
After finishing (or blocking on) a plan: update `plans/README.md`, commit,
report to the operator, and END the session. The operator starts the next
session with the kickoff prompt below.

## Kickoff prompt (operator: paste after /clear)

```
Read plans/000-execution-runbook.md and execute the next eligible plan.
```

## Execution order

| Order | Plan | Where it runs | Note |
|-------|------|---------------|------|
| 1 | `001-verification-baseline.md` | inside `portfolio-2026/` and `denizlg24-app/` (separate git repos) | Also write `plans/baseline.md` (see below) |
| 2 | `002-public-endpoint-hardening.md` | inside `portfolio-2026/` | |
| 3 | `003-monorepo-conversion.md` | repo root (creates the root git repo) | The big one. Read it twice before touching anything. |
| 4 | `004-shared-zod-schemas.md` | monorepo root | |
| 5 | `006-ci-and-dependabot.md` | monorepo root | Runs before 005 — cheap, and gives CI coverage for everything after |
| 6 | `005-responsive-admin-spike.md` | monorepo root | Design spike; produces `docs/responsive-admin-design.md` + follow-up plan list |

"Next eligible plan" = the first row whose README status is TODO and whose
`Depends on` plans are all DONE. If the next plan is BLOCKED or IN PROGRESS,
do not skip ahead — report to the operator instead.

## Per-plan protocol

1. Open `plans/README.md`. Confirm this plan's dependencies are DONE. Set this
   plan's status to IN PROGRESS.
2. Read the ENTIRE plan file before any tool call. Note its STOP conditions.
3. Run the plan's drift check. On mismatch → STOP protocol (below).
4. Execute the steps in order. **Never skip a verification command.** A step
   without its expected result is not done.
5. When all done criteria pass: set status to DONE in `plans/README.md` with a
   one-line note (date + anything notable), commit per the plan's git
   workflow section.
6. Branch handling (operator pre-authorization for this runbook): after ALL
   done criteria pass and the README row is updated, merge the plan's
   `advisor/NNN-*` branch into that repo's default branch with a merge commit.
   Do NOT push to any remote (the GitHub remote is created by the operator
   after plan 006 — see that plan's maintenance notes).
7. Report to the operator: plan number, DONE/BLOCKED, verification results
   (actual command outputs, not paraphrase), files changed, deviations. Only
   claim what you have tool-result evidence for in this session.
8. End the session. Do not start the next plan.

## STOP protocol

A STOP condition fired, a verification failed twice, or reality contradicts
the plan's "Current state":

1. Do not improvise around it. Do not partially continue.
2. Leave the work on its branch (commit what is consistent; never commit a
   broken main/default branch).
3. Set the plan's README status to `BLOCKED (<one-line reason>)`.
4. Report exactly: which STOP condition, what you observed (command + output),
   what you would need decided. End the session.

The operator resolves blocks — possibly by editing the plan — and re-runs the
kickoff prompt.

## Baseline file (plan 001 only, addition to its own instructions)

Plan 001 instructs you to "record" pre-existing typecheck/test failures in
your report. ALSO write them to `plans/baseline.md` (counts + file:line of
each failure, per app). Plans 002–004 compare against "the plan-001 baseline"
— this file is where later sessions find it.

## Hard rules for every implementing session

- The plan's Scope section is law. A file outside "in scope" does not get
  edited, even to fix something obviously broken — report it instead.
- Package manager is bun. Dependency manifests change only via
  `bun add`/`bun remove` (plan 003 lists the few permitted manual edits).
- Never touch `_archive/` (after plan 003 creates it), `bookmark-extension/`,
  `deniz-nutrition-api/`, `macros/`.
- `.env*` files: copy when a plan says to; never print, commit, or paste
  their contents anywhere.
- The eight "Agreed stack decisions" in `plans/README.md` are settled — do
  not revisit them.
- If a plan and this runbook conflict, the plan wins (except README status
  handling and the merge authorization in step 6, which this runbook owns).

## Completion

After plan 005 is DONE: report the full status table, the user-action list
accumulated from plans 003/006 maintenance notes (Vercel root directory,
GitHub push, Turbo Remote Cache, branch protection, archiving old GitHub
repos), and 005's proposed follow-up plans. The operator decides what gets
planned next (007+).
