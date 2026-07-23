# Cloud rewrite program — status

Entry point: `000-execution-runbook.md`. One plan per fresh session. Update
your plan's row when done (date + deviations). Executor = model that runs it.

| Plan | Title | Executor | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Workspace foundation (submodule, scaffolds, turbo, CI skeleton) | opus 4.8 | M | — | TODO |
| 002 | Cloud core port (`@repo/cloud-core`: schema, services, middleware) | gpt5.6 | L | 001 | TODO |
| 003 | Auth: better-auth + API keys + cross-subdomain sessions | gpt5.6 | L | 002 | TODO |
| 004 | Storage engine (files, TUS, S3 `/v2`, shares, tiering) | gpt5.6 | XL | 003 | TODO |
| 005 | Projects platform (provisioning PG/Mongo/Redis, search sync) | gpt5.6 | XL | 003 (004 for storage folders) | TODO |
| 006 | Ops plane (scheduler, executors, metrics, health) | gpt5.6 | L | 003 | TODO |
| 007 | Terminal service rewrite (hardened, tmux-persistent) | gpt5.6 | M | 006 | TODO |
| 008 | `apps/cloud` admin app (dashboard, users, projects, DBs, tasks, terminal, observability) | fable 5 | XL | 003, 006 (007 for terminal tab) | TODO |
| 009 | `apps/storage` file browser app (browse, upload, preview, share, search) | fable 5 | XL | 003, 004 | TODO |
| 010 | UI consolidation & polish (shared components → `@repo/ui`, responsive, a11y) | opus 4.8 | M | 008, 009 | TODO |
| 011 | Infra & deploy (Tailscale, arm64 images, GHCR, compose, CI/CD) | gpt5.6 | L | 001 (finalize after 006) | TODO |
| 012 | Migration scripts, rehearsal & cutover runbook | gpt5.6 + operator | L | 002–011 | TODO |
| 013 | Decommission & docs (remove submodule, archive, dependent-project updates) | opus 4.8 | S | 012 in prod | TODO |

## Notes between sessions

(append dated notes here)
