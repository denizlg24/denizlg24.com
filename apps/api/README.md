# Deniz Cloud API

The Hono API serves Better Auth at `/api/auth/*`, the pending-user signup
flow, and endpoints protected by either a human session or a scoped API key.

## Local development

Start the shared development services from the repository root:

```sh
bun run cloud:dev:infra
```

Run the API with `DATABASE_URL`, `REDIS_ADMIN_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, `MEILISEARCH_URL`, `MEILISEARCH_ADMIN_KEY`,
`SSD_STORAGE_PATH`, `HDD_STORAGE_PATH`, `JWT_SECRET`, and
`S3_CREDENTIAL_ENCRYPTION_KEY` configured. `BETTER_AUTH_SECRET` and
`S3_CREDENTIAL_ENCRYPTION_KEY` must contain at least 32 characters. `JWT_SECRET` must retain the old storage service value
at cutover because existing stateless share links are signed from it.

```sh
bun --env-file=.env run --cwd apps/api dev
```

Storage is served at `/api/storage/*`, storage search at `/api/search`, and
the path-style S3-compatible API at `/v2`. The S3 implementation resolves
credentials from `s3_credentials`. At cutover, configure the old
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` together: startup idempotently
migrates them into the NULL-project full-access row and fails on a collision
or changed secret.

The reusable verification harnesses require their documented `S3_SMOKE_*` and
`TUS_SMOKE_*` environment values:

```sh
bun apps/api/scripts/s3-smoke.ts
bun apps/api/scripts/tus-smoke.ts
```

## Manual signup and TOTP verification

The following is the curl sequence used to verify plan 003. It assumes an
authenticated superuser cookie is already in `admin.cookies`. Replace the
example values and enter the current six-digit code from the authenticator
after scanning the returned `totpURI`.

```sh
API=http://127.0.0.1:3000
ORIGIN=http://localhost:3000

curl --fail-with-body -c admin.cookies -b admin.cookies \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"username":"curl-user","role":"user"}' \
  "$API/api/auth/admin/create-pending-user"

curl --fail-with-body -c enrollment.cookies \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"username":"curl-user","email":"curl-user@example.com","password":"replace-this-password","token":"TOKEN_FROM_PREVIOUS_RESPONSE"}' \
  "$API/api/auth/complete-signup"

curl --fail-with-body -b enrollment.cookies \
  -H "Origin: $ORIGIN" \
  "$API/api/me"
# Expected before enrollment: HTTP 403 with MFA_ENROLLMENT_REQUIRED.

curl --fail-with-body -b enrollment.cookies \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"password":"replace-this-password"}' \
  "$API/api/auth/two-factor/enable"

curl --fail-with-body -b enrollment.cookies -c active.cookies \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}' \
  "$API/api/auth/two-factor/verify-totp"

curl --fail-with-body -b active.cookies \
  -H "Origin: $ORIGIN" \
  "$API/api/me"
# Expected after verification: HTTP 200 and a SafeUser with totpEnabled=true.
```

At cutover, legacy TOTP secrets and recovery codes are deliberately not
imported. Every migrated user must re-scan a new QR code and retain the new
backup codes returned by Better Auth.
