# Plan 008: Email-sync cron reports failure when every account fails

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat bbaedfe..HEAD -- apps/web/app/api/jobs/email/route.ts`
> If `route.ts` changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `bbaedfe`, 2026-06-17

## Why this matters

The email-sync cron (`GET /api/jobs/email`) iterates every IMAP account,
catches per-account errors, and **always returns HTTP 200** — even when every
single account failed to sync. Cron monitors (Vercel Cron, UptimeRobot,
healthchecks.io) treat a 2xx as "job healthy", so a total IMAP outage —
expired credentials, IMAP host down, encryption-key rotation gone wrong — is
completely invisible. The inbox silently stops updating and nobody is paged.

After this plan, a run where **all** accounts fail returns HTTP 500, which any
cron monitor surfaces as a failed job, while partial and full successes keep
returning 200 with per-account counts.

## Current state

- `apps/web/app/api/jobs/email/route.ts` — the entire cron handler. Current
  body (verbatim):

```ts
import { connectDB } from "@/lib/mongodb";
import { syncInbox } from "@/lib/sync-email";
import { EmailAccountModel } from "@/models/EmailAccount";

export async function GET(request: Request) {
  try {
    if (
      request.headers.get("Authorization") !==
      `Bearer ${process.env.EMAIL_JOB_BEARER_TOKEN}`
    ) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    await connectDB();
    const accounts = await EmailAccountModel.find().lean();

    let syncedCount = 0;
    let failedCount = 0;

    for (const account of accounts) {
      try {
        const lastUid = await syncInbox(account);
        await EmailAccountModel.findByIdAndUpdate(account._id, {
          lastUid,
        });
        syncedCount++;
      } catch (error) {
        console.error(`Error syncing account ${account.user}:`, error);
        failedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        message: `Cron job completed: ${syncedCount} accounts synced, ${failedCount} failed`,
        syncedCount,
        failedCount,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.log("Error in email sync cron job:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
```

- Convention reference — the sibling cron `apps/web/app/api/jobs/health-check/route.ts`
  uses `NextResponse.json(...)` and a Bearer-token guard. The email route uses
  the older `new Response(JSON.stringify(...))` style; **keep the email route's
  existing style** (do not migrate it to `NextResponse`) so the diff stays
  minimal and reviewable.
- Test convention — the repo uses `bun:test` with `mock.module(...)` then
  `await import("./route")`. The canonical example is
  `apps/web/app/api/admin/revalidate/route.test.ts`. Match its structure.

## Commands you will need

| Purpose          | Command (run from repo root)                                   | Expected on success |
|------------------|----------------------------------------------------------------|---------------------|
| Typecheck (app)  | `cd apps/web && bun run typecheck`                             | exit 0, no errors   |
| Run this test    | `cd apps/web && bun test app/api/jobs/email/route.test.ts`    | all pass            |
| Lint/format gate | `bun run format-and-lint` (root) or `biome check apps/web/app/api/jobs/email` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `apps/web/app/api/jobs/email/route.ts` (modify)
- `apps/web/app/api/jobs/email/route.test.ts` (create)

**Out of scope** (do NOT touch):
- `apps/web/lib/sync-email.ts` — the per-account sync logic and its internal
  batching are a separate concern (tracked as PERF-03 in the backlog).
- The auth/Bearer-token check — it is correct; do not change it.
- The response *shape* of the success case beyond status code — keep
  `message` / `syncedCount` / `failedCount`. Monitors and any caller may read
  these fields.

## Git workflow

- Branch: `advisor/008-email-cron-failure-status`
- Commit message style: conventional commits, matching `git log` (e.g.
  `fix(web): return 500 from email cron when all accounts fail`).
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Return 500 when every account fails

In `apps/web/app/api/jobs/email/route.ts`, after the `for` loop and before the
existing success `return`, compute a total-failure condition and branch the
status code. Replace the single success `return new Response(...)` block with
logic equivalent to:

```ts
const allFailed = accounts.length > 0 && syncedCount === 0;
const status = allFailed ? 500 : 200;

return new Response(
  JSON.stringify({
    message: `Cron job completed: ${syncedCount} accounts synced, ${failedCount} failed`,
    syncedCount,
    failedCount,
  }),
  {
    status,
    headers: { "Content-Type": "application/json" },
  },
);
```

Rationale for the exact condition:
- `accounts.length > 0 && syncedCount === 0` → every configured account failed
  → 500 (the monitoring blind spot this plan closes).
- Zero accounts configured (`accounts.length === 0`) → 200 (nothing to do, not
  an error).
- Any account synced (`syncedCount > 0`) → 200 even if some failed (partial
  success; `failedCount` is in the body for anyone who wants finer alerting).

**Verify**: `cd apps/web && bun run typecheck` → exit 0, no errors.

### Step 2: Add a characterization test for the cron handler

Create `apps/web/app/api/jobs/email/route.test.ts`, modelled structurally on
`apps/web/app/api/admin/revalidate/route.test.ts` (same `bun:test` +
`mock.module` + `await import("./route")` pattern). Mock the three module
dependencies so no real DB or IMAP connection is made:

- `@/lib/mongodb` → `{ connectDB: mock(async () => {}) }`
- `@/lib/sync-email` → `{ syncInbox: syncInboxMock }`
- `@/models/EmailAccount` → `{ EmailAccountModel: { find, findByIdAndUpdate } }`
  where `find()` returns an object with `.lean()` resolving to your fixture
  accounts, and `findByIdAndUpdate` is a no-op mock.

Set `process.env.EMAIL_JOB_BEARER_TOKEN = "test-token"` in `beforeEach` and
restore in `afterAll` (follow the `REVALIDATE_SECRET` save/restore pattern in
the exemplar). Build the request with an `Authorization: Bearer test-token`
header.

Cover these cases (each asserts `response.status`):
1. **Unauthorized** — no/incorrect Bearer header → status `401`,
   `syncInboxMock` not called.
2. **All accounts fail** — two fixture accounts, `syncInboxMock` rejects for
   both → status `500`, body `failedCount === 2`, `syncedCount === 0`.
3. **Partial failure** — two accounts, first resolves, second rejects →
   status `200`, `syncedCount === 1`, `failedCount === 1`.
4. **All succeed** — two accounts, both resolve → status `200`,
   `failedCount === 0`.
5. **No accounts configured** — `find().lean()` resolves to `[]` → status
   `200`, `syncedCount === 0`, `failedCount === 0`.

**Verify**: `cd apps/web && bun test app/api/jobs/email/route.test.ts` → all 5
tests pass.

### Step 3: Run the lint/format gate

**Verify**: `bun run format-and-lint` → exit 0 (no Biome errors on the two
files). If Biome reports formatting-only diffs on your new file, run
`biome check apps/web/app/api/jobs/email --write` and re-run the gate.

## Test plan

- New file: `apps/web/app/api/jobs/email/route.test.ts`, 5 cases as listed in
  Step 2 (the regression case this plan fixes is case 2: all-fail → 500).
- Structural pattern to copy: `apps/web/app/api/admin/revalidate/route.test.ts`.
- Verification: `cd apps/web && bun test app/api/jobs/email/route.test.ts` →
  all pass.

## Done criteria

ALL must hold:

- [ ] `cd apps/web && bun run typecheck` exits 0
- [ ] `cd apps/web && bun test app/api/jobs/email/route.test.ts` → 5 tests pass
- [ ] The handler returns 500 only when `accounts.length > 0 && syncedCount === 0`
- [ ] `bun run format-and-lint` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 008 updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- The live `route.ts` does not match the "Current state" excerpt (drift).
- `bun test` cannot mock `@/models/EmailAccount` because the model's `find`
  chain is invoked differently than `.find().lean()` in the live code —
  report the actual call shape rather than guessing a mock.
- Typecheck fails twice after a reasonable fix attempt.
- You find a caller (e.g. a Vercel cron config or another route) that asserts
  this endpoint always returns 200 — changing the status could break it; report
  before proceeding.

## Maintenance notes

- If the maintainer later wants alerting on **any** failure (not just total
  failure), change the condition in Step 1 to `failedCount > 0` — but note that
  returning 500 on partial failure will cause cron platforms to retry the whole
  job, re-running `syncInbox` for already-healthy accounts (mostly idempotent
  via UID tracking, but wasteful). That trade-off is why this plan targets
  total failure only.
- A reviewer should confirm the 500 branch does not swallow the per-account
  `console.error` logs (they remain the diagnostic trail).
- Deferred out of scope: pushing failures to `SLACK_WEBHOOK_URL` for active
  alerting — a reasonable follow-up but not required to close the blind spot.
