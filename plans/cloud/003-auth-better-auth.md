# Cloud 003: Auth — better-auth for humans, ported API keys for machines

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: gpt5.6
- **Effort**: L
- **Risk**: HIGH (auth; user migration; cross-origin sessions)
- **Depends on**: 002
- **Category**: security / backend

## Why

The old repo hand-rolls password hashing, TOTP (+AES-256-GCM secret
encryption), JWT sessions, recovery codes, and cookie handling. It works but
is bespoke security-critical code. `apps/web` already uses better-auth; we
standardize human auth on it (Pi-side instance) and keep only what
better-auth doesn't do: scoped API keys and S3 SigV4 (ported in 004).

## Source material (`vendor/deniz-cloud`)

- `packages/shared/src/auth/{password,totp,jwt,recovery}.ts` — argon2id via
  `Bun.password`, TOTP via otpauth (secrets AES-256-GCM-encrypted with
  `TOTP_ENCRYPTION_KEY`), JWT via jose (`JWT_SECRET`), hashed recovery codes.
- `packages/shared/src/middleware/{auth,cookie}.ts` — Bearer JWT or `token`
  cookie or API key; propagates `project` + `scopes` for API keys; session
  auth bypasses scopes.
- Old tables (ported in 002): `users` (role superuser|user, status
  pending|active, nullable passwordHash), `sessions`, `totp_secrets`,
  `recovery_codes`, `api_keys` (SHA-256 hashed keys, projectId, scopes jsonb,
  expiration).
- Flows to preserve: admin creates pending username → user completes signup
  (email, password, mandatory TOTP); login = password + TOTP with recovery
  code fallback; admin panel restricted to superusers; rate limits login
  10/15min, complete-signup 5/15min per IP (CF-Connecting-IP first); generic
  errors against username enumeration.

## Architecture

- better-auth mounted in `apps/api` at `/api/auth/*` (Hono handler), Drizzle
  adapter over the SAME cloud Postgres. Plugins: `twoFactor` (TOTP + backup
  codes), `admin` (roles, user management), `username`.
- **Cross-subdomain sessions**: apps on `cloud.` / `storage.` call
  `api.denizlg24.com` (same site). Configure better-auth
  `advanced.crossSubDomainCookies` with domain `.denizlg24.com`,
  `trustedOrigins: ["https://cloud.denizlg24.com",
  "https://storage.denizlg24.com"]` (+ localhost dev origins), and Hono CORS
  middleware with the same allowlist + `credentials: true`. Cookies stay
  SameSite=Lax (subdomains are same-site) — verify with an integration test
  using Origin headers.
- **Unified auth middleware** (completes 002's stub): resolve better-auth
  session OR `Authorization: Bearer <api-key>`; API keys keep old semantics
  (SHA-256 lookup, project + scopes propagation, `requireScope`; sessions
  bypass scopes; `requireRole("superuser")` guards admin routes, mapped from
  better-auth admin plugin role).
- Client helper: better-auth client factory in `packages/schemas/src/cloud/`
  (or a tiny `@repo/cloud-auth-client` if schemas must stay dependency-free —
  prefer the latter only if adding the dep to schemas pollutes apps/web;
  record choice in Drift log). Apps 008/009 consume it with `baseURL`
  `https://api.denizlg24.com`.

## Scope

1. `bun add better-auth` in `apps/api` (+ drizzle adapter needs). Generate
   better-auth schema via its CLI into `cloud-core`'s Drizzle schema as NEW
   tables/migration (do not mutate old tables — migration maps data).
2. Implement server config incl. twoFactor with **argon2id-compatible
   verification**: better-auth's password verification must accept existing
   `Bun.password` argon2id hashes. better-auth supports custom
   `password.verify`/`hash` — plug `Bun.password.verify` in so migrated
   hashes keep working; keep argon2id for new hashes.
3. **User migration script** `apps/api/scripts/migrate-users.ts`
   (idempotent, dry-run flag, runs in 012): old `users` → better-auth
   user/account rows (password hash carried over); `totp_secrets` →
   twoFactor rows — old secrets are AES-256-GCM encrypted with
   `TOTP_ENCRYPTION_KEY`; decrypt with the ported primitive and re-store in
   better-auth's expected format (it encrypts with its own secret). Recovery
   codes: hashed old codes CANNOT convert to better-auth backup codes —
   generate fresh backup codes per user, output them to an operator-only
   encrypted report file, and flag affected users in the report (cutover
   comms). `pending` users → migrated with a fresh signup-completion token
   flow (see 4). Old `sessions` are NOT migrated (everyone re-logs-in).
4. Re-implement the pending-signup flow on better-auth: admin creates user
   (admin plugin) with status metadata `pending`; completion endpoint sets
   email/password, enforces TOTP enrollment before first real session. Keep
   enumeration-safe generic errors + ported rate limiter on both endpoints.
5. Wire `/api/auth` + unified middleware into `apps/api`; protect `/healthz`
   stays public; add `/api/me` returning the `SafeUser` zod shape.
6. Tests: middleware matrix (session/API key/scope/role), signup flow,
   migration script against a seeded dev DB (seed with OLD-format rows
   created via ported 002 primitives), cross-origin cookie integration test.

## Verification

```
bunx turbo typecheck --filter=api --filter=@repo/cloud-core
bunx turbo test --filter=api          # incl. migration dry-run test
bun run format-and-lint
# manual: bun dev apps/api + dev infra; curl login flow with TOTP (document
# the curl sequence in apps/api/README.md as you verify it)
```

## STOP conditions

Runbook STOPs, plus: better-auth cannot accept custom argon2id verify (would
force a password-reset-for-everyone cutover — operator decision); twoFactor
plugin's TOTP parameters (period/digits/alg) can't match otpauth defaults
used by existing enrolled authenticators — report before inventing a
compatibility shim.

## Drift log

- **2026-07-23 — operator decision after the TOTP STOP:** Better Auth 1.6.25
  interprets its stored TOTP HMAC key differently from the legacy OTPAuth
  Base32 secret, so the same legacy enrollment cannot produce matching codes.
  The operator chose mandatory TOTP re-enrollment at cutover. There is no
  compatibility shim and no decode-once secret migration. `migrate-users.ts`
  sets every Better Auth user to `twoFactorEnabled=false`, writes no
  `auth_two_factor` rows, invalidates legacy recovery codes in its encrypted
  operator report, and marks every user `requiresTotpEnrollment=true`. Legacy
  TOTP/recovery rows remain untouched solely for pre-point-of-no-return
  rollback and are never trusted by the new auth stack. New backup codes are
  generated by Better Auth when each user enrolls. `TOTP_ENCRYPTION_KEY` was
  therefore removed from the new API runtime/compose contract. Plan 012 and
  its cutover runbook must make re-enrollment mandatory.
- **2026-07-23 — client package choice:** The Better Auth client factory lives
  in the dependency-isolated `@repo/cloud-auth-client` package rather than
  `@repo/schemas`, keeping the canonical wire-schema package free of runtime
  auth dependencies. Apps 008/009 should consume this factory.
