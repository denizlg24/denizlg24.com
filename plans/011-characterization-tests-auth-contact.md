# Plan 011: Characterization tests for the admin auth gate and contact flow

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat bbaedfe..HEAD -- apps/web/lib/require-admin.ts apps/web/app/api/contact/route.ts`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (adds tests only; touches no production code)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `bbaedfe`, 2026-06-17

## Why this matters

`requireAdmin` is the single gate protecting every admin API route, and the
public contact endpoint is the one unauthenticated write path on the site —
yet neither has a test. The repo has only 9 test files total. These two
modules are the highest-risk untested code: a regression in `requireAdmin`
silently opens the whole admin surface; a regression in the contact route
breaks the rate limit or validation that plan 002 added.

These are **characterization tests** — they pin down current behavior so future
refactors (notably the deferred DEBT-05 god-file splits) have a safety net.
This plan adds tests only; it changes no production behavior. If a test reveals
a genuine bug, that is a STOP-and-report event, not a fix-in-this-plan event.

## Current state

**`apps/web/lib/require-admin.ts`** — two exported async functions:

```ts
import crypto from "node:crypto";
import { forbidden } from "next/navigation";
import type { NextRequest } from "next/server";
import ApiKey from "@/models/ApiKey";
import { getServerSession } from "./get-server-session";
import { connectDB } from "./mongodb";

export async function requireAdmin(request?: NextRequest) {
  // 1. If an `authorization: Bearer <token>` header is present, SHA-256-hash
  //    the token and look it up in ApiKey; on match -> return null (authorized).
  // 2. Otherwise getServerSession(); if no session/user, not emailVerified, or
  //    role !== "admin" -> forbidden() (which THROWS); else return null.
}

export async function getAdminSession(request?: NextRequest) {
  // Same Bearer path, but on match returns a synthetic admin session object.
  // Session path returns the session on success, or null on any failure
  // (does NOT throw — unlike requireAdmin).
}
```

Key behavioral facts to characterize:
- `forbidden()` (from `next/navigation`) **throws**; `requireAdmin` relies on
  that to halt unauthorized requests. `getAdminSession` returns `null` instead.
- Bearer token is hashed with `crypto.createHash("sha256")` before the
  `ApiKey.findOne({ key: hash })` lookup.
- Dependencies to mock: `@/models/ApiKey` (`.findOne(...).lean()`),
  `./get-server-session` (`getServerSession`), `./mongodb` (`connectDB`), and
  `next/navigation` (`forbidden`).

**`apps/web/lib/get-server-session.ts`** (the session source, for reference):

```ts
export const getServerSession = async (request?: NextRequest) => {
  return await auth.api.getSession({
    headers: request ? request.headers : await headers(),
  });
};
```

**`apps/web/app/api/contact/route.ts`** — public `POST` handler:

```ts
import { contactInputSchema } from "@repo/schemas";
import { ipAddress } from "@vercel/functions";
import { type NextRequest, NextResponse } from "next/server";
import { createContact } from "@/lib/contacts";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendContactConfirmation } from "@/lib/resend";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const _ipAddress = ipAddress(request) || "unknown";
    const { allowed, resetMs } = await checkRateLimit(`contact:${_ipAddress}`, {
      maxRequests: 5, windowMs: 3_600_000,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Too many submissions. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) } });
    }
    const validationResult = contactInputSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({ error: "Please provide a valid name, email and message." },
        { status: 400 });
    }
    const { name, email, message } = validationResult.data;
    const userAgent = request.headers.get("user-agent") || "unknown";
    const contact = await createContact({ name, email, message, ipAddress: _ipAddress, userAgent });
    const emailResult = await sendContactConfirmation({ to: email, name, ticketId: contact.ticketId, message });
    return NextResponse.json(
      { success: true, message: "Contact form submitted successfully",
        ticketId: contact.ticketId, emailSent: emailResult.success },
      { status: 201 });
  } catch (error) {
    console.error("Error submitting contact form:", error);
    return NextResponse.json({ error: "Failed to submit contact form" }, { status: 500 });
  }
}
```

Dependencies to mock: `@vercel/functions` (`ipAddress`), `@/lib/rate-limit`
(`checkRateLimit`), `@/lib/contacts` (`createContact`), `@/lib/resend`
(`sendContactConfirmation`). Leave `@repo/schemas` **unmocked** — the real
`contactInputSchema` is what you want to characterize.

**Test convention** — `bun:test` with `mock.module(...)` then
`await import("./route")` / `await import("./require-admin")`. Canonical
exemplar: `apps/web/app/api/admin/revalidate/route.test.ts` (mock modules,
build a `Request`, assert `response.status` and `await response.json()`).
`process.env` save/restore in `beforeEach`/`afterAll` per that file.

## Commands you will need

| Purpose      | Command (from repo root)                                          | Expected |
|--------------|------------------------------------------------------------------|----------|
| Typecheck    | `cd apps/web && bun run typecheck`                               | exit 0   |
| Auth test    | `cd apps/web && bun test lib/require-admin.test.ts`             | all pass |
| Contact test | `cd apps/web && bun test app/api/contact/route.test.ts`        | all pass |
| All web tests| `cd apps/web && bun test --env-file=../../.env`                  | all pass |
| Lint/format  | `bun run format-and-lint`                                         | exit 0   |

## Scope

**In scope** (create only):
- `apps/web/lib/require-admin.test.ts`
- `apps/web/app/api/contact/route.test.ts`

**Out of scope** (do NOT modify):
- `apps/web/lib/require-admin.ts`, `apps/web/app/api/contact/route.ts`, and
  every other production file. This plan adds tests; it does not change
  behavior. If a test exposes a real bug, STOP and report it as a new finding.
- The email-sync cron route — its characterization test is owned by plan 008;
  do not duplicate it here.

## Git workflow

- Branch: `advisor/011-characterization-tests-auth-contact`
- Commit style: conventional commits, e.g.
  `test(web): characterization tests for requireAdmin and contact route`.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Characterization tests for `require-admin.ts`

Create `apps/web/lib/require-admin.test.ts`. Mock the four dependencies:

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const findOneMock = mock(() => ({ lean: async () => null }));
const getServerSessionMock = mock(async () => null);
const forbiddenMock = mock(() => { throw new Error("FORBIDDEN"); });

mock.module("@/models/ApiKey", () => ({ default: { findOne: findOneMock } }));
mock.module("@/lib/get-server-session", () => ({ getServerSession: getServerSessionMock }));
mock.module("@/lib/mongodb", () => ({ connectDB: mock(async () => {}) }));
mock.module("next/navigation", () => ({ forbidden: forbiddenMock }));

const { requireAdmin, getAdminSession } = await import("./require-admin");
```

Use a helper to build a request with an optional `authorization` header, e.g.
`new Request("http://localhost", { headers }) as unknown as NextRequest`.
Reset all mocks in `beforeEach`.

Cases for `requireAdmin`:
1. Valid Bearer token (ApiKey lookup returns a doc) → resolves to `null`,
   `getServerSessionMock` not called.
2. No auth header, no session → calls `forbidden()` (assert the call rejects /
   `forbiddenMock` was called — wrap in `expect(...).rejects` or try/catch).
3. Session present, `emailVerified: false` → `forbidden()` invoked.
4. Session present, verified, `role: "user"` → `forbidden()` invoked.
5. Session present, verified, `role: "admin"` → resolves to `null`.

Cases for `getAdminSession`:
6. Valid Bearer token → returns the synthetic admin session
   (`user.role === "admin"`, `user.email === "admin-token"`); does **not** throw.
7. No session → returns `null` (not a throw — this is the key behavioral
   difference from `requireAdmin`).
8. Non-admin session → returns `null`.

**Verify**: `cd apps/web && bun test lib/require-admin.test.ts` → all pass.

### Step 2: Characterization tests for the contact `POST` route

Create `apps/web/app/api/contact/route.test.ts`. Mock:

```ts
const checkRateLimitMock = mock(async () => ({ allowed: true, resetMs: 0 }));
const createContactMock = mock(async () => ({ ticketId: "TICKET-123" }));
const sendContactConfirmationMock = mock(async () => ({ success: true }));
const ipAddressMock = mock(() => "1.2.3.4");

mock.module("@vercel/functions", () => ({ ipAddress: ipAddressMock }));
mock.module("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
mock.module("@/lib/contacts", () => ({ createContact: createContactMock }));
mock.module("@/lib/resend", () => ({ sendContactConfirmation: sendContactConfirmationMock }));

const { POST } = await import("./route");
```

Build requests as JSON `POST`s (content-type `application/json`). Reset mocks in
`beforeEach`. Cases:
1. **Happy path** — valid `{ name, email, message }`, rate limit allows →
   status `201`, body `success: true`, `ticketId: "TICKET-123"`,
   `emailSent: true`; `createContactMock` called once.
2. **Rate limited** — `checkRateLimitMock` returns `{ allowed: false, resetMs: 3600000 }`
   → status `429`, `Retry-After` header present, `createContactMock` NOT called.
3. **Invalid body** — e.g. missing `email` or empty `message` (whatever
   `contactInputSchema` rejects) → status `400`, `createContactMock` NOT called.
   Discover the exact required fields by reading
   `packages/schemas/src/*` for `contactInputSchema` if needed; do not mock it.
4. **Downstream failure** — `createContactMock` rejects → status `500`.
5. **emailSent reflects send result** — `sendContactConfirmationMock` returns
   `{ success: false }` on an otherwise valid request → status `201`,
   `emailSent: false`.

**Verify**: `cd apps/web && bun test app/api/contact/route.test.ts` → all pass.

### Step 3: Full web suite + gates

**Verify**:
- `cd apps/web && bun test --env-file=../../.env` → all pass (the two new
  files plus the existing 6). The `--env-file` is required: the `.env` lives at
  the repo ROOT, and bun only auto-loads `apps/web/.env` (absent), so the
  full suite's mongodb-coupled modules (`lib/projects.test.ts`,
  `lib/triage.test.ts`) throw at module load without it.
- `cd apps/web && bun run typecheck` → exit 0
- `bun run format-and-lint` → exit 0 (run `biome check <new files> --write` if
  it reports formatting diffs)

## Test plan

- New: `apps/web/lib/require-admin.test.ts` (8 cases, Step 1) and
  `apps/web/app/api/contact/route.test.ts` (5 cases, Step 2).
- Structural pattern: `apps/web/app/api/admin/revalidate/route.test.ts`.
- These pin current behavior; the most valuable assertions are
  `requireAdmin` case 2/4 (unauthorized → throws) and contact case 2 (rate
  limit enforced), since those are the security-relevant invariants.

## Done criteria

ALL must hold:

- [ ] `apps/web/lib/require-admin.test.ts` exists with the 8 cases; passes
- [ ] `apps/web/app/api/contact/route.test.ts` exists with the 5 cases; passes
- [ ] `cd apps/web && bun test --env-file=../../.env` → all tests pass (existing + new)
- [ ] `cd apps/web && bun run typecheck` exits 0
- [ ] `bun run format-and-lint` exits 0
- [ ] **No production files modified** (`git status` shows only the 2 new test files)
- [ ] `plans/README.md` status row for 011 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A test cannot reproduce the documented behavior because the live code differs
  from the "Current state" excerpt (drift).
- `mock.module` cannot intercept a dependency because it is imported/used
  differently than shown (e.g. `ApiKey.findOne` is not `.findOne().lean()` in
  the live code) — report the actual call shape.
- Writing an honest test forces you to assert behavior that looks like a **bug**
  (e.g. `getAdminSession` authorizing something it should not) — report it as a
  new finding rather than encoding the bug as "expected".
- Any case requires modifying a production file to become testable — that is a
  testability finding to report, not a change to make under this plan.

## Maintenance notes

- These tests are the prerequisite safety net for the deferred DEBT-05 god-file
  refactors (`triage.ts`, `chat-view.tsx`, `person-detail.tsx`) and for any
  future change to the auth gate. Extend them before refactoring those.
- A reviewer should confirm no production file appears in the diff and that the
  auth-failure cases assert a *throw* (not a falsy return) for `requireAdmin`.
- Follow-up explicitly deferred: characterization tests for `sync-email.ts`
  `syncInbox` (heavily IMAP-coupled; needs an IMAP client fake) and the broader
  admin-route suite — separate, larger efforts.
