# Status app compute audit — 2026-09-30

## Evidence and limits

- Production deployment `dpl_59r2h8CEDjR5Jykg7MVmH2JE3o3Q` uses the same status and host-agent files as this worktree's starting commit. The Vercel project has fluid compute enabled and runs on the Hobby plan.
- Vercel runtime logs for six complete minutes, 14:17–14:22 UTC, show **10 distinct `/api/agent/*` requests and one `/api/collect` request every minute**. The CLI repeated records, so these counts deduplicate by request ID. Each Pi and Forge agent sends three reports and one claim; the Mac sends one report and one claim. This matches the one-minute host timers and `agent.py`.
- Observability Plus route metrics are unavailable and `vercel usage` returned `USAGE_UNAVAILABLE`, so this audit cannot attribute billed Active CPU to a route or measure current CPU per invocation. The source scan found no traffic-independent CPU candidate. The 822 KB status icon is a transfer issue, not a supported explanation for Active CPU.
- [Vercel's fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing) bills Active CPU for execution, not time waiting on network or database I/O. Long collector wall time can consume provisioned memory without using the same amount of Active CPU. Its `maxDuration = 120` is a timeout limit, not a CPU budget.

## Changes prepared in this worktree

1. Add an authenticated `sync` message so each host sends all current reports and claims its next command in **one request per minute**. Keep the old `report` and `claim` messages for staged rollout. Once all three hosts run the new agent, the steady-state agent request count should fall from 10 to 3 per minute. Report freshness and the one-minute command poll remain the same. The server still writes each report to MongoDB, so the Active CPU reduction needs measurement after rollout.
2. Invalidate the public cache once per sync instead of once for every backup report. Existing agents retain their current behavior until upgraded.
3. Load the incident pre-verdict module only when a new automatic incident opens. The ordinary collector run no longer eagerly loads that module and its AI SDK dependencies. The production build puts it in a separate server chunk; the Active CPU effect is unmeasured.

Deploy the status server first, then install the updated agent on Pi, Forge, and Mac. Old agents continue working with the new server. Updating only the server does not reduce request frequency.

## Remaining options

| Priority | Option | Expected effect | Decision constraint |
| --- | --- | --- | --- |
| Next | Compare distinct agent request IDs per minute before and after rollout, then check Active CPU and provisioned memory in Vercel Usage over comparable full days. | Proves whether fewer invocations reduce the exhausted resource. | Route-level CPU attribution remains unavailable without Observability Plus. |
| If Active CPU stays high | Profile `/api/collect` at the application level and narrow expensive parsing or aggregation. It fetches Better Stack lists, validates cloud observations, writes backups and samples, and recomputes daily buckets each minute. | Targets CPU work after the agent request reduction is measured. | Reducing network waits alone targets wall time and memory, not necessarily Active CPU. |
| If collector dominates | Run collection on an independent scheduled host and leave Vercel serving the public page and admin API. | Removes the collector invocation from Vercel. | Monitoring must remain independent of the hosts it checks; the scheduler needs secure access to MongoDB and provider credentials. |
| Last resort | Increase host-agent interval and backup freshness window together. | Fewer agent invocations. | Slower backup-status updates and command pickup; the current three-minute freshness rule cannot be left unchanged. |

Lowering `maxDuration` alone will not reduce CPU used by successful runs and can interrupt incident reconciliation. The public status page already caches its MongoDB view for 30 seconds, so its cache policy is not the first CPU candidate without traffic evidence.

## Verification

- `python3 -m unittest infra.status.test_agent`: 12 passed.
- `bun test lib` in `apps/status`: 53 passed, 7 MongoDB integration tests skipped because the dedicated local database was unavailable.
- `bun run typecheck` and `bun run build` in `apps/status`: passed. The build logged admin API fetch failures during static generation; the build still completed.
- After deployment, deduplicate `vercel logs --json` by request ID before counting invocations. Expect three agent requests per complete minute after all hosts are upgraded. Compare full-day Active CPU usage in the Vercel dashboard before claiming a cost reduction.
