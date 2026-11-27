# apps/api — the cloud API on the Pi

## Operating it

- **Restarting the API by hand silently downgrades it.** `API_IMAGE=` is empty in
  `.env.pi` on purpose: the deploy passes it inline, as
  `API_IMAGE=ghcr.io/denizlg24/deniz-cloud-api:<40-char sha> API_VERSION=<sha>`.
  A plain `docker compose --env-file .env.pi ... up -d api` therefore takes the
  compose default, `:latest`, which on the Pi is whatever was pulled last — it
  was a month stale when this bit. Omitting `-f docker-compose.posix.yml` on a
  `STORAGE_NAMESPACE_MODE=broker-mounted` box drops the storage mounts in the
  same breath. The whole command is:

  ```
  API_IMAGE='ghcr.io/denizlg24/deniz-cloud-api:<sha>' API_VERSION='<sha>' \
    docker compose -p deniz-cloud --env-file .env.pi \
    -f docker-compose.pi.yml -f docker-compose.posix.yml up -d api
  ```

  Nothing fails when you get this wrong — the container starts, `/healthz`
  answers, and it serves the old build. `/healthz` reports `version`, which is
  `API_VERSION`: if it says `latest` rather than a sha, the wrong image is
  running.
- **The healthcheck does not mean ready.** `createRuntimeApp()` is built lazily on
  the first `/api/*` request and `/healthz` sits outside `/api/*`. A container can
  report healthy having seeded no tasks, reconciled no Redis ACLs and started no
  workers. After any deploy, hit `/api/me` (expect 401) and confirm
  `scheduled_tasks` still holds the schedules you expect.
- **UFW `INPUT` policy is DROP.** Containers cannot reach host services unless a
  rule allows the docker subnets. This is why the terminal needs
  `ufw allow from 172.16.0.0/12 to any port 3003 proto tcp`.
- **Secrets that cannot change**: `JWT_SECRET` (share links),
  `DATABASE_CREDENTIAL_ENCRYPTION_KEY` (= the old `TOTP_ENCRYPTION_KEY`; project DB
  passwords), `S3_CREDENTIAL_ENCRYPTION_KEY`, and the legacy `S3_ACCESS_KEY_ID` /
  `S3_SECRET_ACCESS_KEY` pair that dependent projects still sign with.

## Migration and cutover scripts

`apps/api/scripts/` (`cutover:*` in its package.json) share one harness in
`scripts/lib/runner.ts`: dry-run by default, `--execute` required to write,
`--dry-run` and `--execute` together is an error, JSONL audit log via `--log`, one
JSON summary line on stdout, and marker rows in `auth_verification` enforcing
order (schema → users → s3). Full reference in `docs/internal/cutover/`.

## Auth internals

Cross-cutting auth (parties, superuser tokens, rollout order) is in the root CLAUDE.md.

- **Tenants: someone else's app signing people in with deniz auth.** Plan 027.
  A client whose `metadata.tenant` is set (only our routes write it;
  `/oauth2/register` refuses `metadata`, and a client with no creator is never
  a tenant's) is held to `tenantAccess` in `auth/tenancy.ts` instead —
  tenant enabled, account active, not blocked by that tenant, the tenant's
  MFA and verified-email policy — and its tokens carry `tenant` and **never**
  `superuser`, even when the owner signs in. Tenant resources live in
  `auth_oauth_resource.tenant_id`; a first-party client may not bind one and
  a tenant client may bind nothing else. `/api/oauth/clients` (the owner's
  view) hides tenant clients; `/api/tenants/*` manages them.
  `GET /api/public/tenants/client/:id/return?to=` confirms a "Back to {app}"
  link for the auth app's account pages: 200 only when `to` is https (or
  loopback http) on an origin of one of that tenant client's redirect URIs,
  the same 404 otherwise (`auth/return-link.ts`).
- **Two realms in `auth_user`: `cloud` (owner, family; has a `users` row) and
  `public` (self-service sign-up for a tenant's app).** The column defaults to
  `public`, so any new creation path that forgets to say `cloud` makes an
  account that reaches nothing of the cloud's; `createPendingAuthUser` and the
  cutover scripts set it. `resolveSession` refuses a non-cloud session even if
  a `users` row exists for it, mandatory TOTP applies to `cloud` only, and
  password reset by email mails `public` accounts only; `/two-factor/disable`
  is refused for `cloud`, and for a `public` account that manages a tenant or
  holds a consent or live grant on a tenant with `mfa: required`
  (`auth/two-factor-disable.ts`). `/change-password` and `/update-user` are the
  plugin's own, open to both realms. `/api/account` and
  `/api/tenants` serve both realms on cookie sessions (`auth/identity.ts`) and
  refuse a mutation without a trusted `Origin`.
- **Public sign-up is off unless explicitly configured**: both
  `TURNSTILE_SECRET_KEY` and `RESEND_API_KEY` on the API, or
  `AUTH_PUBLIC_ACCOUNTS_DEV=1` locally. Never key it on `NODE_ENV` (folded to
  false in the production bundle). It answers identically for new and
  existing addresses and never signs in; the verification link does.
- **A refused browser authorization is a redirect, not JSON.** `GET
  /oauth2/authorize` sends the browser to `<auth app>/login?reason=<CODE>`
  with the original query, which the login page turns into the fix
  (verify email, set up MFA, use another account) and then resumes.
- **"Remember me" is a refresh-token handle, not a longer session.** The
  login checkbox (default on) flags the cloud session (`auth_session.remember_me`,
  0045), and a first-party client (`skipConsent`: web, desktop) authorizing from
  such a session receives `rm_<family>.<hmac>` in place of a refresh token — a
  stable name for the grant's `authorizationCodeId` family. The provider still
  rotates rows underneath; `apps/api/src/auth/remember-me.ts` resolves the handle
  to the family's live row and stamps it non-expiring, so a phone that lost a
  token response is still signed in and nothing runs out until the handle is
  revoked (sign-out, MFA reset, account gone). MCP clients are excluded and keep
  30-day rotating tokens. The cloud session's own 24 h is untouched. Two plugin
  facts the module is built around: refresh tokens are SHA-256 hashed at rest
  (`storeTokens` is now ours so the hash is pinned), and
  `formatRefreshToken.encrypt` is called **synchronously** — its result is
  concatenated, not awaited — so the awaited hooks resolve everything into
  `AsyncLocalStorage` state first, which is why `app.ts` wraps the auth handler
  in `withOAuthRequestState`. Unchecked is Better Auth's real `rememberMe:
  false`: a browser-session cookie, rotating tokens as before.
- **A passkey is both factors.** `@better-auth/passkey` (pinned to the
  better-auth version; 1.7.5 peers on a newer core) signs in on
  `/passkey/verify-authentication`, which the twoFactor hook does not match,
  so there is no TOTP step. That is why `apps/api/src/auth/passkey.ts`
  requires a resident, user-verified credential at registration and refuses
  an assertion whose authenticator did not verify the user — the plugin
  itself verifies with `requireUserVerification: false` on both ceremonies.
  The rpID is the cookie domain (`denizlg24.com`; `PASSKEY_RP_ID` overrides)
  because the plugin's default is the *API's* hostname, which no browser on
  auth.denizlg24.com can use; the origin list pins ceremonies to the auth
  app. Rows live in `auth_passkey` (0050) and are managed at
  auth.denizlg24.com/security. A passkey session is always remember-me: the
  path is not `/sign-in/*` and carries no flag, so the session hook falls
  through to the cookie branch.
- **"Trust this device" is the plugin's own `trustDevice`**, a signed
  `deniz-cloud.trust_device` cookie backed by an `auth_verification` row
  (`trust-device-*`, value = user id) that the credential sign-in hook checks
  and **re-issues on every sign-in**. `trustDeviceMaxAge` is a year, so it is
  how long a device may go unused, not a re-prompt interval. The plugin never
  lists or revokes trust: `GET/POST /api/auth/trusted-devices[/revoke]`
  (`apps/api/src/auth/trusted-devices.ts`) count and delete the rows. The
  cookie only ever reaches the API — Forge's edge strips it with the rest of
  `deniz-cloud.*`.

- **A sign-in link replaces the password, never the second factor.**
  `magicLink` in `better-auth.ts` (no table; tokens are SHA-256-hashed rows in
  `auth_verification`, single-use, 15 minutes, `disableSignUp`). The plugin
  signs in on `/magic-link/verify`, which the twoFactor hook does not match,
  so `settleSignInLink` does its job: an account with TOTP loses the session
  the plugin made and gets the plugin's own `two_factor` cookie and rows, and
  the browser lands on `<auth app>/login?signInLink=challenge` — unless the
  trust-device cookie is valid, exactly as on the password path (and it is
  re-issued). Link sessions are never remember-me (`dont_remember` is set for
  the TOTP step). Only active, unbanned accounts with `emailVerified` (and,
  for `cloud`, TOTP) are mailed — **the plugin deletes every credential and
  session of an unverified account it verifies a link for**, so issuance
  refuses them and an `account.delete.before` guard on that path refuses the
  race. Cloud accounts are created with `emailVerified: false`; the owner's
  issuance takes `confirmEmail` to vouch for one. The callback is always the
  auth app's `/login` (so `trustedOrigins`, also the CSRF list, is unchanged)
  and the destination a `returnTo` held to `sign-in-link-issuance.ts`'s list:
  trusted origins plus https redirect origins of clients an active superuser
  created — never dynamic or tenant-admin clients — plus the API's authorize
  endpoint. `app.ts` checks both on request and on verify (a hand-edited
  link lands on `?signInLink=error&error=INVALID_LINK` before the token is
  spent) and turns a refusal raised inside Better Auth (a ban) into the same
  landing, since an after hook cannot change a failed status. The
  self-service request sits with the other mail routes (Turnstile, 5 per
  15 min per IP, 404 unless public accounts are configured);
  `POST /api/auth/admin/send-sign-in-link` (superuser session; `copy` needs
  a browser session, not `oauth:`) needs only `RESEND_API_KEY` and records
  `auth.sign_in_link_issued`. Sign-in pushes carry "sign-in link".
  `sign-in-link.integration.test.ts` covers it.
- **A TV signs in by code (RFC 8628).** `oauthDeviceAuthorization` in
  `better-auth.ts` (table `auth_device_code`, migration 0056) issues tokens
  through the provider like any grant, so `customAccessTokenClaims` holds a
  device token to the same tenant and superuser rules. Approval is
  auth.denizlg24.com/device; `app.ts` refuses `/device/approve` for an
  account the client's tenant would refuse, so the phone hears it rather
  than the TV. Only a client whose `grant_types` list
  `urn:ietf:params:oauth:grant-type:device_code` may ask for a code — a hand
  edit of the row, like the redirect additions. `device.integration.test.ts`
  covers the flow.
