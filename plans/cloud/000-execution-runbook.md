# Cloud 000: Execution runbook — rewrite deniz-cloud into this monorepo

> **This file is the entry point for implementing sessions.** Each plan file in
> `plans/cloud/` is self-contained. This runbook tells you which plan to run,
> which agent runs it, how to run it, and what to do between plans.
>
> **Deadline**: production cutover by **2026-08-15** (operator moves abroad and
> will depend on this system for remote access to their home network).

## What this program is

`E:\PersonalProjects\deniz-cloud` is a self-hosted home-server platform running
on a Raspberry Pi 5 (4GB RAM): storage service (files + TUS + S3-compatible
API + share links), exposed databases (Postgres 16 :5433, MongoDB 8.2+mongot
:27018, Redis 7 w/ per-project ACLs :6380), Meilisearch, per-project database
provisioning, MongoDB→Meilisearch sync, scheduled tasks (backups, restarts),
admin panel, and a web terminal. It grew exploratorily ("vibecoded") and is
being rewritten INTO this monorepo with better architecture, security, UI, and
infrastructure — then cut over **big-bang** (not strangler).

**Live dependents**: multiple external projects use the databases, Redis, S3
API, and Meilisearch tenant tokens today. Their data must survive cutover
untouched (data stays in place; containers are swapped). Their configuration
changes (S3 endpoint URL) happen in the cutover runbook (plan 012).

## Locked decisions (operator-confirmed 2026-07-23 — do not re-litigate)

1. **Big-bang cutover** with migration scripts + rehearsed runbook. Old repo
   keeps running until cutover day; no dual-running strangler period.
2. **Topology**: `api.denizlg24.com` = the Pi (Hono/Bun behind Cloudflare
   Tunnel; serves storage API, admin API, S3 `/v2`, WS terminal).
   `cloud.denizlg24.com` (admin panel) and `storage.denizlg24.com` (file
   browser) = **two Next.js apps on Vercel** (`apps/cloud`, `apps/storage`).
   Consequence: the S3 endpoint moves from `storage.denizlg24.com/v2` to
   `api.denizlg24.com/v2`; dependent projects update `S3_ENDPOINT` at cutover.
3. **Auth**: better-auth (same library as `apps/web`) for human auth on the Pi
   API — email+password + TOTP; cross-subdomain cookies on `.denizlg24.com`.
   Custom scoped API keys and S3 SigV4 credentials are kept (ported, not
   replaced). Users are migrated by script (plan 003).
4. **Remote access**: Tailscale — Pi as subnet router + Tailscale SSH. DDNS +
   router port-forwarding stay ONLY for the publicly exposed DB ports
   (dependent projects connect via public hostnames).
5. **Terminal**: hardened rewrite (plan 007). No `privileged`/`pid: host`
   containers, no nsenter. tmux-backed persistent sessions, admin auth.
6. **Observability**: no Prometheus/Grafana. The Pi API collects rich metrics
   (host + per-container + network + disks) persisted to Postgres; dashboards
   in `apps/cloud`; integration with `apps/web`'s existing "resources"
   health-check system.
7. **Reference source**: deniz-cloud is added as a **git submodule** at
   `vendor/deniz-cloud` (plan 001) so executing agents can read the old
   implementation. It is removed at decommission (plan 013). Read-only:
   NEVER edit files inside the submodule.
8. Monorepo conventions apply (see `plans/README.md` maintainer decisions):
   scaffold-first, deps via `bun add` only (latest versions), zod schemas as
   canonical contracts, strict TS (no `any`/`unknown` casts), Biome, bun.

## New capabilities (operator-requested — beyond parity with the old system)

The rewrite is parity PLUS these features the old system never implemented
(verified missing 2026-07-23). Each is specced inside the owning plan — this
list exists so nobody mistakes them for ports:

| Capability | Plans | Old-system reality |
|------------|-------|--------------------|
| Per-project S3 credentials (issue/rotate/revoke, prefix-scoped) | 004 (schema+SigV4), 005 (endpoints), 008 (UI), 012 (legacy keypair migration) | ONE global env keypair shared by everyone |
| Tiering engine: SSD→HDD demotion cron + on-access promotion | 004 (engine), 006 (`tiering_pass` task), 008 (dry-run UI), 012 (enable-after-soak) | `storage_tier` column exists; zero tiering code, no cron |
| Bulk download as ZIP | 004 (streaming endpoint), 009 (multi-select UI) | never built (old PLAN.md Phase 5) |
| Task/backup failure notifications | 006 | never built |
| Metrics history + observability dashboards | 006, 008 | point-in-time stats only |
| Persistent, authenticated web terminal | 007, 008 | crashing privileged nsenter container |
| fail2ban on DB ports; opt-in TLS for exposed DBs; load-tested memory budget | 011 | never done (old PLAN.md Phase 4) |

## Agent assignment

Three executor models run these plans. The operator starts each session with
the right model; each plan's Status block names its executor.

| Agent | Strengths | Assigned plans |
|-------|-----------|----------------|
| **gpt5.6** | Hard backend work (protocols, crypto, sync engines, infra). Not great at UI — give it none. | 002, 003, 004, 005, 006, 007, 011, 012 |
| **fable 5** | Large integrated chunks spanning UI + backend contract. | 008, 009 |
| **opus 4.8** | Gruntwork and UI-only work (scaffolding, porting, polish, docs). | 001, 010, 013 |

## Execution order

Dependencies form three lanes after 001; lanes can interleave across sessions
but a plan must not start before everything in its "Depends on" row is DONE.

```
001 (foundation)
 ├─► 002 (core port) ─► 003 (auth) ─► 004 (storage engine) ─► 005 (projects platform)
 │                                 └► 006 (ops plane) ─► 007 (terminal)
 ├─► 011 (infra/deploy — can start after 001, finalize after 006)
 └─► 008 (cloud app — needs 003+006), 009 (storage app — needs 003+004)
     └─► 010 (UI consolidation — needs 008+009)
012 (migration & cutover — needs ALL of 002–011)
013 (decommission — needs 012 verified in production)
```

Suggested calendar (target 2026-08-15, ~3.5 weeks): 001–003 by Jul 27;
004–007 + 011 by Aug 3; 008–009 by Aug 8; 010 + 012 rehearsal by Aug 12;
cutover weekend Aug 13–15; 013 after.

## Per-plan protocol

1. Start a **fresh session** in `E:\PersonalProjects\denizlg24.com` with the
   assigned model. One plan per session/context window.
2. Read the plan file fully, then `plans/cloud/README.md` for statuses and any
   notes left by previous sessions.
3. Follow the plan step by step. Run every verification command and confirm
   the expected result before moving on.
4. Old-code questions → read the referenced files in `vendor/deniz-cloud`.
   The old repo is evidence, not gospel: preserve **contracts** (wire formats,
   hashes, on-disk layouts), improve implementations.
5. On completion: update the status row in `plans/cloud/README.md` (date +
   deviations), commit with a conventional message, report, END the session.
6. Deviations that change a contract other plans rely on must be recorded in
   the status row AND in the affected plan files' "Drift log" section.

## STOP conditions (all plans)

Stop and report — do not improvise — if:
- A verification command fails and the fix isn't within the plan's scope.
- You need to modify anything under `vendor/deniz-cloud` (never allowed).
- A locked decision above appears wrong or impossible.
- You need production secrets or Pi access a plan says you don't need.
- A dependency plan's deliverable is missing or diverges from what your plan
  states (check its README status row first — it may document the drift).
- Data-destructive action against real data outside the rehearsal/cutover
  runbook steps that explicitly authorize it.

## Kickoff prompt (operator: paste after /clear, adjust plan number)

> Read plans/cloud/000-execution-runbook.md, then plans/cloud/README.md, then
> execute plans/cloud/NNN-<slug>.md. Follow the per-plan protocol and STOP
> conditions. Do not start any other plan.
