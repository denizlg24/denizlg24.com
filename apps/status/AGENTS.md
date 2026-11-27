<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Collector, incidents and triage

- **It runs on Forge, so a Forge outage takes the page down with it.**
  Better Stack is the outside watchdog for that case. The collector is
  triggered from the Pi (picron), and `/healthz` answers 503 while the latest
  snapshot is older than three minutes, so the container healthcheck probes
  `/robots.txt` instead — a first deploy has no snapshot yet.

`apps/status` collects once a minute (`/api/collect`, picron job `Status - Collect` on the Pi, bearer `STATUS_CRON_SECRET`): its own
probes of every app, the API's `/healthz/status`, Better Stack monitors and
heartbeats. Design and rollout: `docs/internal/plans/022-status-incident-rules-and-agent.md`;
operator side: `docs/internal/runbooks/status-incident-agent.md`.

- **One failed observation is a degradation, three in a row are an outage.**
  `confirmStatus` in `lib/health.ts` derives the status the page shows from
  the raw verdict (`observed`) and the preceding samples' raw verdicts: `down`
  needs `DOWN_CONFIRM_OBSERVATIONS` (3) consecutive, leaving `down` or
  `degraded` needs `RECOVER_OBSERVATIONS` (2) clean ones, and `unknown` holds
  the last confirmed status for 10 observations. Consequence worth knowing: a
  service failing four minutes in five reads `degraded`, never `down`, and
  opens no incident. Samples store both `status` (confirmed; what the daily
  buckets count) and `observed`.
- **Better Stack's `down` needs corroboration.** It checks every few minutes
  and its verdict is sticky — a monitor reads `down` until its next check, an
  incident stays open through its recovery period — so re-read each minute,
  one failed check looked like three fresh failures and confirmed an outage
  on its own (a 2-minute auth deploy swap became an incident on 2026-09-15).
  `summarizeService` counts a Better Stack `down` as `degraded` whenever the
  service's own evidence has a fresh pass and no failure; it stands when our
  probe agrees or has nothing to say.
- **A dependency's *confirmed* outage degrades its dependents; its blips do
  not.** The dependency pass runs after confirmation, on confirmed statuses,
  and adds at most `degraded`.
- **Incidents are derived here, not mirrored.** `planIncidents` in
  `lib/incidents.ts` opens `auto:` incidents on a confirmed `down`, merges
  services related through `incidentRelations` into one, posts a public
  `monitoring` update on recovery and resolves `AUTO_RESOLVE_MINUTES` (5)
  later; a regression clears `recoveredAt`. Better Stack incidents are
  evidence only, linked by id when one coincides so acknowledge/resolve and
  the enrichment comment reach it; the `betterstack:` rows that exist are
  history and only follow their upstream to resolution. Heartbeats never open
  incidents — before this, 28 of 60 incidents had no service at all.
- **An open incident no longer forces a tile red.** `data.ts` shows the
  confirmed status; an incident is the narrative on top. Incidents with no
  service are not shown publicly.
- **Maintenance is applied in the collector**, so a service in a window is
  `maintenance` in the snapshot and the samples, never builds a down streak
  and never opens an incident. `repeat: "weekly"` recurs at the same weekday
  and time (`maintenanceCovers`); one row covers the Sunday 02:00 UTC reboot.
- **Every automatic incident starts one triage run on denizlg24.com**
  (`lib/agent.ts`, `POST /api/admin/background-agent/runs` with a token from
  `STATUS_OAUTH_CLIENT_ID/SECRET`), unless one of its services had a run in
  the last hour. The run's verdict (`transient` / `operational` / `code`) lands
  on the incident through `status_incidents update`; `code` escalates through
  `status_incidents escalate`, which opens the GitHub issue
  (`STATUS_GITHUB_TOKEN`, labels `incident` + `agent-fix`) and then fires the
  "Incident fixer" Claude Code routine through its API trigger
  (`lib/routine.ts`, `STATUS_ROUTINE_FIRE_URL/TOKEN`) with the issue in the
  payload. Not a GitHub trigger: routines only take pull request and release
  events, so no issue event can start one. The routine also sweeps daily for
  anything a failed fire missed. Unset credentials skip each step silently:
  the incident still opens.
- **A routine's connector tools are gated by `permitted_tools`, not
  `allowed_tools`.** Every tool of an attached connector is otherwise callable
  without approval. The Incident fixer permits only the read tools plus
  `status_incidents`; anything else hits a permission prompt nobody answers,
  so the run stalls rather than restarting or redeploying something. Its
  sandbox has no `gh` (it uses the built-in GitHub tools) and Bun 1.3.
- **The admin API and the server actions share `lib/admin-ops.ts`.** Routes
  under `app/api/admin/*` authenticate with `requireActor` (bearer for the
  status resource, else the cloud cookie) and go through `adminRoute`; every
  write is audited under the actor (`client:<id>` for the MCP server).
  Input contracts are `@repo/schemas/status`.
