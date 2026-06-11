# Plan 002: Harden portfolio-2026 public endpoints (rate limits, pagination, mass-assignment, error detail)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: in `portfolio-2026/` run
> `git diff --stat b1fe917..HEAD -- app/api/contact app/api/blog app/api/admin/blogs lib/rate-limit.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (rate limiting can lock out legitimate users if keyed wrong)
- **Depends on**: plans/001-verification-baseline.md
- **Category**: security
- **Planned at**: portfolio-2026 @ `b1fe917`, 2026-06-11

## Why this matters

portfolio-2026 is a public website with unauthenticated API endpoints. Audit
confirmed four issues:

1. **No rate limiting on the public contact form** (`app/api/contact/route.ts`)
   — each submission writes to MongoDB AND sends an email via Resend
   (`sendContactConfirmation`), so the endpoint is a mail-bombing / spam vector
   against arbitrary third-party addresses.
2. **No rate limiting on public blog comment/view endpoints** — verified by
   `grep -rn checkRateLimit`: only `app/api/admin/chat/route.ts` and
   `app/api/admin/llm/route.ts` use the existing rate limiter.
3. **Unbounded comment query**: `app/api/blog/comments/route.ts` returns ALL
   matching comments with no `.limit()`.
4. **Mass assignment**: `app/api/admin/blogs/[id]/route.ts` PATCH spreads the
   raw request body into `findByIdAndUpdate` — any Blog schema field can be
   overwritten (admin-authenticated, but the desktop client sends partial
   bodies and a malformed payload can corrupt documents).

A working in-house rate limiter already exists (`lib/rate-limit.ts`,
MongoDB-backed, atomic pipeline update) — this plan only *applies* it.

## Current state

All paths relative to `E:\PersonalProjects\denizlg24.com\portfolio-2026`.

- `lib/rate-limit.ts` — `checkRateLimit(key, { maxRequests=20, windowMs=60_000 })`
  → `{ allowed, remaining, resetMs }`. Do not modify it.
- **Exemplar usage to copy exactly** — `app/api/admin/chat/route.ts:97-114`:

```ts
const ip =
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
const { allowed, remaining, resetMs } = await checkRateLimit(`chat:${ip}`, {
  maxRequests: 10,
});

if (!allowed) {
  return NextResponse.json(
    { error: "Rate limit exceeded" },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(resetMs / 1000)),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}
```

- `app/api/contact/route.ts` — POST handler. Note it already imports
  `ipAddress` from `@vercel/functions` (line 1) and computes
  `const _ipAddress = ipAddress(request) || "unknown"` at line 30 — but only
  AFTER validation. It currently returns zod issue details to the client:

```ts
// app/api/contact/route.ts:17-26
const validationResult = contactSchema.safeParse(body);
if (!validationResult.success) {
  return NextResponse.json(
    {
      error: "Validation failed",
      details: validationResult.error.issues,
    },
    { status: 400 },
  );
}
```

- `app/api/blog/comments/route.ts` — GET builds a `query` object (approved
  comments, or own-session comments) then at ~line 72:

```ts
const comments = await BlogComment.find(query)
  .sort({ createdAt: parentId ? 1 : -1 })
  .lean();
```

  The same file is expected to contain the public POST handler for creating
  comments — confirm by opening the file (see Step 3).

- `app/api/blog/views/route.ts` — public view-count endpoint, no rate limit
  (verified via the grep above; open the file to see its handlers before
  editing).

- `app/api/admin/blogs/[id]/route.ts:56-68` — PATCH mass assignment:

```ts
await connectDB();

const updateData = { ...body };
if (body.content !== undefined) {
  updateData.timeToRead = calculateReadingTime(body.content);
}

const blog = await Blog.findByIdAndUpdate(id, updateData, {
  new: true,
  runValidators: true,
})
```

- Conventions: zod 4 is already a dependency and used in
  `app/api/contact/route.ts:7-11`; route handlers return
  `NextResponse.json(...)`; errors are caught per-handler with a generic 500.

## Commands you will need

| Purpose | Command (in `portfolio-2026/`) | Expected on success |
|---------|--------------------------------|---------------------|
| Install | `bun install` | exit 0 |
| Typecheck | `bun run typecheck` | no NEW errors vs the baseline recorded by plan 001 |
| Tests | `bun test` | all pass |
| Lint | `bun run lint` | no new findings in touched files |
| Dev server (manual smoke) | `bun run dev` | serves on localhost:3000 |

## Scope

**In scope** (the only files you should modify/create):
- `app/api/contact/route.ts`
- `app/api/blog/comments/route.ts`
- `app/api/blog/views/route.ts`
- `app/api/admin/blogs/[id]/route.ts`
- `lib/blog-update-schema.ts` (create)
- `lib/blog-update-schema.test.ts` (create)

**Out of scope** (do NOT touch):
- `lib/rate-limit.ts` — works as designed; the over-limit `$pop` compensation
  is intentional.
- `lib/require-admin.ts`, auth, sessions.
- Any `app/api/admin/**` route other than `blogs/[id]`.
- The desktop client (`denizlg24-app`) — its PATCH calls send `{ toggleActive }`
  or full update bodies per the documented API; the whitelist in Step 4 must
  keep those working (fields listed there).
- Response shapes on success paths — the desktop client depends on them.

## Git workflow

- Repo: `portfolio-2026/` (its own git repo).
- Branch: `advisor/002-public-endpoint-hardening`.
- One commit per step, plain imperative messages (repo uses short messages),
  e.g. `Add rate limiting to public contact endpoint`.
- Do NOT push.

## Steps

### Step 1: Rate-limit the contact form

In `app/api/contact/route.ts` POST, immediately after `const body = await request.json();`
hoist the existing IP lookup above validation and add:

```ts
const _ipAddress = ipAddress(request) || "unknown";
const { allowed, resetMs } = await checkRateLimit(`contact:${_ipAddress}`, {
  maxRequests: 5,
  windowMs: 3_600_000,
});
if (!allowed) {
  return NextResponse.json(
    { error: "Too many submissions. Please try again later." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) },
    },
  );
}
```

Import `checkRateLimit` from `@/lib/rate-limit`. Remove the now-duplicate
`_ipAddress` declaration at the old position (line ~30).

**Verify**: `bun run typecheck` → no new errors.

### Step 2: Stop returning zod issue details

In the same handler, replace the 400 body with a generic message:

```ts
return NextResponse.json(
  { error: "Please provide a valid name, email and message." },
  { status: 400 },
);
```

(The public form does its own client-side display; field-level details are
not consumed from the API — if you find frontend code reading
`details` from this response, STOP and report.) Search:
`grep -rn "details" app/contact components | head` to confirm nothing consumes it.

**Verify**: grep above shows no consumer of the contact 400 `details` field.

### Step 3: Rate-limit blog comments + views, cap comment query

Open `app/api/blog/comments/route.ts` and `app/api/blog/views/route.ts` fully
before editing.

- For every **POST/PUT/PATCH** handler in those two files: add the Step-1
  pattern with key prefix `comment:` / `view:` and `maxRequests: 10`,
  `windowMs: 60_000`. Derive IP the same way (`ipAddress(request) || "unknown"`).
- For the comments **GET**: add `.limit(200)` to the `BlogComment.find(query)`
  chain. Do NOT add skip/cursor pagination — the blog UI loads all comments at
  once today; 200 is a safety cap, not a paging API.

**Verify**: `bun run typecheck` → no new errors. `bun run lint` → clean on
touched files.

### Step 4: Whitelist blog PATCH fields

Create `lib/blog-update-schema.ts`:

```ts
import { z } from "zod";

export const blogUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    excerpt: z.string().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    media: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
```

**Before finalizing the field list**: open `models/Blog.ts` and the desktop
client's blog edit calls (`denizlg24-app` PATCHes per
`E:\PersonalProjects\denizlg24.com\CLAUDE.md`: `{ toggleActive: true }` or a
full update body of `{ title, excerpt, content, tags?, media?, isActive? }`).
If `models/Blog.ts` has differently-named/typed fields for `media` or `tags`,
match the schema to the model. The `toggleActive` branch is handled before the
update path and must remain untouched.

In `app/api/admin/blogs/[id]/route.ts` PATCH, replace
`const updateData = { ...body };` with:

```ts
const parsed = blogUpdateSchema.safeParse(body);
if (!parsed.success) {
  return NextResponse.json({ error: "Invalid update payload" }, { status: 400 });
}
const updateData: Record<string, unknown> = { ...parsed.data };
```

keeping the existing `timeToRead` recalculation (`body.content` →
`parsed.data.content`).

**Verify**: `bun run typecheck` → no new errors.

### Step 5: Tests

Create `lib/blog-update-schema.test.ts` (model after
`lib/projects.test.ts` — `import { describe, expect, test } from "bun:test"`):

- accepts a full valid update body
- accepts a partial body (`{ title: "x" }`)
- **rejects** unknown fields (`{ createdAt: "2020-01-01" }`, `{ slug: "x" }`)
- rejects wrong types (`{ tags: "not-an-array" }`)

**Verify**: `bun test lib/blog-update-schema.test.ts` → all pass.

### Step 6: Manual smoke test

`bun run dev`, then (PowerShell):

```powershell
1..7 | ForEach-Object { (Invoke-WebRequest -Uri http://localhost:3000/api/contact -Method POST -Body '{"name":"Test Person","email":"t@example.com","message":"hello hello hello"}' -ContentType "application/json" -SkipHttpErrorCheck).StatusCode }
```

Expected: first responses `201` (or `500` if Resend/Mongo env is not
configured locally — acceptable, the rate limiter runs before/after
independent failures; what matters is:) requests 6-7 return `429`.
If local env lacks MongoDB the limiter itself can't run — then skip this step
and note it in the report.

## Test plan

- `lib/blog-update-schema.test.ts` as in Step 5 (4+ cases).
- Rate-limit behavior is covered by the Step 6 smoke test (the limiter itself
  is pre-existing and exercised in production via the chat/llm routes).
- Verification: `bun test` → all pass including new file.

## Done criteria

- [ ] `bun run typecheck` — no new errors vs plan-001 baseline
- [ ] `bun test` — passes, includes ≥4 new schema tests
- [ ] `grep -n "checkRateLimit" app/api/contact/route.ts app/api/blog/comments/route.ts app/api/blog/views/route.ts` — ≥1 hit per file
- [ ] `grep -n "validationResult.error.issues" app/api/contact/route.ts` — no matches
- [ ] `grep -n "{ \.\.\.body }" "app/api/admin/blogs/[id]/route.ts"` — no matches
- [ ] `git status` — only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `app/api/blog/comments/route.ts` has no POST handler (the comment-creation
  endpoint lives elsewhere) — report where comment creation actually happens
  instead of hunting for it.
- The desktop client or public site code reads the contact 400 `details`
  field (Step 2 grep hits).
- `models/Blog.ts` fields diverge so much from the documented update body that
  the whitelist would need >8 fields — report the field list for review.
- Rate limiting breaks the admin chat/llm routes' tests or types (you touched
  something out of scope).

## Maintenance notes

- The rate limiter is MongoDB-backed; if the site moves behind a different
  proxy/CDN, revisit the `x-forwarded-for` / `ipAddress()` derivation (all
  keys collapse to `"unknown"` if the header disappears — fail-open by IP).
- If the blog editor later adds fields (e.g. `slug`, `coverImage`), they must
  be added to `blogUpdateSchema` or PATCH silently 400s — reviewer should flag
  this coupling in the PR description.
- Deferred: per-email rate keying on the contact form (IP-only for now);
  comment pagination API (cap only).
