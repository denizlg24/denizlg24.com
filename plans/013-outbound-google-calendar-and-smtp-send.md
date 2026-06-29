# Plan 013: Outbound Google Calendar sync + SMTP sending setup

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report - do not improvise.
> When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 5f47772..HEAD -- apps/web/app/api/admin/calendar apps/web/app/api/admin/email-accounts apps/web/lib/calendar-events.ts apps/web/models/CalendarEvent.ts apps/web/models/EmailAccount.ts packages/admin/src/calendar packages/admin/src/inbox packages/schemas/src/calendar.ts packages/schemas/src/email.ts`
> If these files changed since this plan was written, compare the "Current
> state" section against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED-HIGH (OAuth tokens, encrypted mail credentials, external API
  side effects)
- **Depends on**: 012, or at least the 2026-06-26c checkpoint where calendar
  and inbox feature bodies live in `packages/admin`
- **Category**: integration / product
- **Planned at**: `HEAD` = 5f47772, 2026-06-28
- **Current**: TODO

## Maintainer-confirmed decisions (2026-06-28)

1. **Google Calendar is outbound-only.** Local app calendar events are sent to
   Google Calendar. Do not import, list, reconcile, or read Google Calendar
   events back into the app.
2. **The app remains the source of truth.** Google Calendar is a mirror. Local
   create/update/delete should not fail just because Google is unavailable.
3. **Email sending is SMTP-only.** Do not implement Gmail API sending or
   Microsoft Graph `sendMail` in this plan.
4. **Gmail/Outlook account buttons are assisted SMTP setup.** They prefill
   provider settings and link to the provider's setup/security pages. They are
   not OAuth mail-provider login buttons in this plan.

If decision 4 is wrong and the desired UX is true "Sign in with Gmail/Outlook"
for mail, stop before implementation. That introduces mail OAuth scopes and a
different verification/security profile. It can still send through SMTP via
XOAUTH2, but it is not the same scope as password/app-password SMTP.

## References checked

- Google Calendar event insert supports write scopes such as
  `https://www.googleapis.com/auth/calendar.events.owned`:
  https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- Google Calendar OAuth scopes:
  https://developers.google.com/workspace/calendar/api/auth
- Google app passwords:
  https://support.google.com/accounts/answer/185833
- Gmail third-party client guidance:
  https://support.google.com/mail/answer/7126229
- Outlook.com IMAP/SMTP settings and Modern Auth note:
  https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040
- Microsoft OAuth over IMAP/POP/SMTP, for future mail-OAuth follow-up:
  https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth

## Why this matters

The admin calendar and inbox are useful locally, but they stop at the app
boundary:

- Calendar events are stored locally and displayed in `packages/admin`, with
  generated holidays/birthdays handled by local sync helpers. There is no
  external calendar provider state.
- Inbox account setup is IMAP-only and manual. Sending exists in the UI but
  `ComposeDialog` currently closes with "Send email is not yet implemented".

This plan adds two practical integrations without turning the app into a
two-way groupware system:

- Push local manual calendar events into the connected Google Calendar.
- Send email through the selected account's SMTP server.
- Make Gmail/Outlook setup easier with provider buttons, preset server values,
  and direct provider setup links.

## Current state

- `packages/schemas/src/calendar.ts`
  - `calendarEventSourceSchema.provider` is currently only `"nager-date"` or
    `"people"`.
  - `calendarEventSchema.kind` is `"manual" | "holiday" | "birthday"`.
- `apps/web/models/CalendarEvent.ts`
  - The `source.provider` enum matches the schema and has a unique index on
    `source.provider` + `source.providerKey`.
  - No remote sync fields exist.
- `apps/web/lib/calendar-events.ts`
  - `createCalendarEvent`, `updateCalendarEvent`, and `deleteCalendarEvent`
    own local writes and serialization.
- `apps/web/app/api/admin/calendar/route.ts`
  - `POST` creates a local event.
  - `GET` reads local/generator-backed events.
- `apps/web/app/api/admin/calendar/[id]/route.ts`
  - `PATCH` updates a local event.
  - `DELETE` deletes or suppresses a local event.
- `apps/web/models/EmailAccount.ts`
  - Stores IMAP host/port/secure/user/encrypted password/inbox/last UID.
  - No SMTP fields exist.
- `apps/web/lib/email.ts` and `apps/web/lib/sync-email.ts`
  - Use `imapflow` for inbox reading/syncing.
- `apps/web/app/api/admin/email-accounts/route.ts`
  - Adds an account by testing IMAP credentials and storing encrypted password.
- `packages/admin/src/inbox/add-account-dialog.tsx`
  - Has simple IMAP presets for Gmail/Outlook/Yahoo/iCloud.
- `packages/admin/src/inbox/compose-dialog.tsx`
  - Shows a compose UI but does not send.

## Product defaults

- Google Calendar sync is off until an admin connects Google.
- Sync only `kind: "manual"` calendar events in v1. Holidays and birthdays are
  generated/derived locally and likely duplicate data already available in
  Google; do not push them unless the maintainer explicitly changes this
  default.
- Use Google Calendar `primary` by default. Allow the admin to enter a calendar
  ID manually later, but do not list calendars because this plan is outbound
  only.
- Store Google remote event IDs and sync state locally. Do not discover remote
  events by listing Google Calendar.
- Existing local events are not automatically bulk-pushed on connect. Provide
  an explicit "Sync existing manual events" action.
- SMTP account setup keeps the existing IMAP read path. Sending uses SMTP
  fields on the same account.
- Provider setup buttons should reduce friction, but still make credential
  requirements explicit:
  - Gmail: app password route for password SMTP/IMAP setup.
  - Outlook: prefill Outlook settings and link to Microsoft settings/help. If
    Outlook blocks password SMTP because Modern Auth is required, surface that
    clearly instead of silently switching to Graph or adding OAuth in this plan.

## Architecture

### Google Calendar outbound mirror

Add two small models instead of overloading `CalendarEvent.source`:

```ts
CalendarExternalConnection {
  provider: "google";
  enabled: boolean;
  calendarId: string; // default "primary"
  accountEmail?: string;
  scope: string[];
  encryptedRefreshToken: EncryptedSecret;
  connectedAt: Date;
  updatedAt: Date;
  lastSyncAt?: Date;
  lastSyncError?: string;
}

CalendarExternalEventSync {
  provider: "google";
  localEventId: ObjectId;
  remoteCalendarId: string;
  remoteEventId: string;
  lastSyncedHash?: string;
  lastSyncedAt?: Date;
  pendingAction?: "upsert" | "delete";
  lastError?: string;
  updatedAt: Date;
}
```

Notes:

- Keep this generic enough for future providers, but only implement Google.
- Unique index: `{ provider: 1, localEventId: 1, remoteCalendarId: 1 }`.
- Do not add `"google"` to `CalendarEvent.source.provider`; that source field is
  for event origin, not outbound mirror state.
- Generate deterministic Google event IDs to make retries idempotent. Use a
  prefix that only contains Google-supported event ID characters, for example
  `d24${localObjectId}`. Mongo ObjectId hex characters are valid for this.

### SMTP sending

Extend `EmailAccount` with optional SMTP fields:

```ts
provider?: "custom" | "gmail" | "outlook" | "yahoo" | "icloud";
displayName?: string;
smtpHost?: string;
smtpPort?: number;
smtpSecure?: boolean;
smtpRequireTls?: boolean;
smtpUser?: string;
smtpPassword?: EncryptedSecret;
smtpFromName?: string;
smtpFromAddress?: string;
lastSmtpTestAt?: Date;
lastSmtpError?: string;
```

Notes:

- Keep `imapPassword` for existing inbound sync. For new accounts, default SMTP
  credentials to the same password/app password unless the admin enters an
  SMTP-specific override.
- Never return encrypted SMTP or IMAP credentials from admin GET routes.
- Compose sends from a selected account. If no account is selected, require the
  user to pick a sender.

## Build order

### Step 1: Dependencies and secret helper

Run from `apps/web` so dependencies land in the web package, not the root:

```bash
cd apps/web
bun add googleapis nodemailer
bun add -d @types/nodemailer
```

Create a generic encrypted-secret helper:

- Add `apps/web/lib/encrypted-secret.ts` with AES-256-GCM encrypt/decrypt for
  arbitrary strings.
- Rework `apps/web/lib/safe-email-password.ts` as a thin compatibility wrapper
  around the new helper so existing call sites still work.
- Keep the current `IMAP_ENCRYPTION_KEY` behavior for compatibility, but rename
  the helper internals away from email/password language.
- Validate key presence and length with a clear server-side error. Do not log
  plaintext secret values.

**Verify**: `cd apps/web && bun run typecheck`.

### Step 2: Add schemas and models

Add shared schemas:

- `packages/schemas/src/calendar.ts`
  - `calendarExternalConnectionSchema`
  - `calendarExternalSyncSchema`
  - response schemas for integration status.
- `packages/schemas/src/email.ts`
  - add provider and SMTP metadata fields to `emailAccountSchema`
  - keep encrypted fields out of public serialized account responses where
    routes already omit them.

Add web models:

- `apps/web/models/CalendarExternalConnection.ts`
- `apps/web/models/CalendarExternalEventSync.ts`
- Extend `apps/web/models/EmailAccount.ts` with optional SMTP fields.

**Verify**:

```bash
bunx turbo typecheck --filter=@repo/schemas
cd apps/web && bun run typecheck
```

### Step 3: Implement Google Calendar OAuth and status routes

Create `apps/web/lib/google-calendar.ts`:

- Builds the OAuth2 client from env:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_CALENDAR_REDIRECT_URI`
- Uses `access_type=offline` and `prompt=consent` on connect so a refresh token
  is returned.
- Requests the minimum calendar write scope:
  - `https://www.googleapis.com/auth/calendar.events.owned`
- Optionally request `openid email` only if the UI needs to display the connected
  account email. Do not add broad Gmail/mail scopes here.
- Stores only the encrypted refresh token, not long-lived plaintext tokens.

Add admin routes:

- `GET /api/admin/calendar/google`
  - Return connected/enabled status, calendar ID, account email if present, last
    sync timestamp, and last error.
- `POST /api/admin/calendar/google/connect`
  - Creates a CSRF/state nonce in an httpOnly cookie and returns the Google
    authorization URL.
- `GET /api/admin/calendar/google/callback`
  - Validates state, requires the admin session, exchanges code for tokens,
    stores encrypted refresh token, redirects back to the calendar page.
- `PATCH /api/admin/calendar/google`
  - Enable/disable sync and update `calendarId`.
- `DELETE /api/admin/calendar/google`
  - Disconnects and deletes encrypted token/sync state after confirmation.

**Verify**: add route tests that mock `googleapis` and assert state validation,
missing-code handling, and encrypted token persistence without network calls.

### Step 4: Implement one-way event sync helper

In `apps/web/lib/google-calendar-sync.ts`, add:

- `toGoogleEventPayload(event)`
  - `summary`: local `title`
  - `location`: local `place`
  - timed events: `start.dateTime` / `end.dateTime`
  - all-day events: `start.date` / exclusive `end.date`
  - description: links rendered as plain text URLs
  - reminders: `useDefault: true` in v1; do not map Slack notification settings
    to Google reminders.
- `syncEventToGoogle(localEventId, action)`
  - action `upsert`: insert if no sync row, patch if remote ID exists.
  - action `delete`: delete known remote event if present.
  - never list or import Google events.
  - records `lastSyncedAt`, `lastSyncedHash`, `pendingAction`, and `lastError`.
- Idempotency behavior:
  - Use deterministic `remoteEventId`.
  - If insert returns conflict/already-exists, patch the same ID and mark
    success.
  - If delete returns not found/gone, clear pending delete and mark success.

Hook local writes:

- After successful `createCalendarEvent`, enqueue/schedule an upsert for manual
  events when Google sync is enabled.
- After successful `updateCalendarEvent`, enqueue/schedule an upsert for manual
  events.
- After successful `deleteCalendarEvent`, enqueue/schedule delete for any known
  remote sync row.
- Use `after()` from Next where appropriate so local mutations are not blocked
  by Google latency.

Add retry/admin routes:

- `POST /api/admin/calendar/google/sync`
  - Explicit backfill for manual events in a provided date range, defaulting to
    upcoming events.
- `POST /api/admin/calendar/google/retry`
  - Retries rows with `pendingAction` or `lastError`.
- Optional cron follow-up route guarded by Bearer token:
  - `GET /api/jobs/calendar-google-sync`
  - Keep this optional unless manual retry is insufficient.

**Verify**:

- Unit tests for event mapping, all-day end dates, deterministic IDs, conflict
  handling, and delete-not-found handling.
- Route tests mock Google client and assert local API responses stay 200 even
  when the outbound sync records an error.

### Step 5: Add Calendar UI controls

Update `packages/admin/src/calendar/calendar-page.tsx`:

- Add a compact Google Calendar integration control in the calendar header.
- States:
  - disconnected: "Connect Google Calendar"
  - connected/enabled
  - connected/paused
  - last sync failed, with retry action
- Add a settings dialog/sheet with:
  - connect/disconnect
  - enable/disable
  - calendar ID input, default `primary`
  - "Sync existing manual events" button
  - last sync status/error
- Do not add Google event import UI.
- Do not add generated holiday/birthday sync controls in v1.

Update app adapters if `AdminClient` currently needs route wrappers for these
new endpoints.

**Verify**:

- Calendar renders with no integration configured.
- Connect button handles returned OAuth URL.
- Backfill/retry buttons call the intended admin endpoints.

### Step 6: Extend account setup for SMTP

Replace the current IMAP-only preset shape in
`packages/admin/src/inbox/add-account-dialog.tsx` with provider presets:

```ts
{
  provider: "gmail",
  label: "Gmail",
  imap: { host: "imap.gmail.com", port: 993, secure: true },
  smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  setupLinks: [...]
}
```

Suggested presets:

- Gmail:
  - IMAP `imap.gmail.com:993` SSL
  - SMTP `smtp.gmail.com:465` SSL
  - setup link: Google app passwords
- Outlook:
  - IMAP `outlook.office365.com:993` SSL
  - SMTP `smtp-mail.outlook.com:587` STARTTLS
  - setup link: Outlook.com POP/IMAP/SMTP settings
  - warning: personal Outlook.com requires Modern Auth/OAuth2; password/app
    password SMTP may not work for every account.
- iCloud:
  - IMAP `imap.mail.me.com:993` SSL
  - SMTP `smtp.mail.me.com:587` STARTTLS
- Yahoo:
  - IMAP `imap.mail.yahoo.com:993` SSL
  - SMTP `smtp.mail.yahoo.com:465` SSL
- Custom:
  - all fields editable.

UI requirements:

- Provider buttons at the top: Gmail, Outlook, iCloud, Yahoo, Custom.
- Selecting a provider pre-fills both IMAP and SMTP settings.
- Show setup links in buttons, not as long instructional text.
- Add "Use same credentials for sending" toggle, default on.
- If off, show SMTP username/password override.
- Add optional From name and From email fields.
- Keep current account add flow testing IMAP; add SMTP verification only when
  SMTP fields are present.

Server route changes:

- Update `apps/web/app/api/admin/email-accounts/route.ts` POST validation with
  zod.
- Test IMAP first as today.
- Test SMTP transport with `verify()` if SMTP settings are provided.
- Store encrypted SMTP password or mark it as shared with the IMAP secret.
- Keep GET serialization excluding both `imapPassword` and `smtpPassword`.

**Verify**:

- Existing accounts with no SMTP fields still list and sync.
- New Gmail preset posts both IMAP and SMTP config.
- Invalid SMTP credentials return a generic actionable 400 without logging the
  password.

### Step 7: Implement SMTP send route

Create `apps/web/lib/smtp.ts`:

- Builds a `nodemailer` transport from the selected account.
- Decrypts SMTP password, or falls back to IMAP password when configured to use
  shared credentials.
- Supports `secure` and `requireTLS`.
- Normalizes provider-specific host/port defaults server-side instead of
  trusting only the client.

Add route:

- `POST /api/admin/email-accounts/[id]/send`

Request body:

```ts
{
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  replyToMessageId?: string;
}
```

Validation and security:

- Require admin auth.
- Validate email addresses with zod.
- Limit recipient count, subject length, and body size.
- Do not allow arbitrary `from` outside the configured account address.
- Do not expose SMTP server error details that include credentials.
- Rate limit if there is an existing project helper; otherwise document a
  follow-up. Admin-only is not a reason to skip input validation.

Sent-message behavior:

- v1 may rely on the provider's SMTP server to place messages in Sent when it
  does so.
- Do not implement IMAP append-to-Sent unless testing shows Gmail/Outlook do not
  keep sent mail for SMTP sends.
- Log send metadata minimally: account ID, recipient count, provider, success or
  generic failure. Do not log message body.

**Verify**:

- Route tests mock `nodemailer.createTransport` and assert success, validation
  failure, auth failure, and SMTP failure.

### Step 8: Wire Compose UI to SMTP sending

Update `packages/admin/src/inbox/inbox-page.tsx`:

- Pass selected account ID and account list into `ComposeDialog`.
- If composing from "All Inboxes" and more than one send-capable account exists,
  show a From selector.
- Disable send with clear UI state when no account has SMTP configured.

Update `packages/admin/src/inbox/compose-dialog.tsx`:

- Replace "not yet implemented" toast with the POST call.
- Add loading state and validation feedback.
- Keep the initial compose surface simple: To, Subject, Body, Send.
- Reply uses existing `replyTo` values for To and Subject.
- Attachments are out of scope for v1.

**Verify**:

- Compose sends from selected account.
- Reply sends to the original sender.
- Empty/invalid recipients are blocked client-side and server-side.

### Step 9: Final verification

Run:

```bash
cd apps/web && bun run typecheck
cd apps/web && bun test
bunx turbo typecheck
bun --env-file=.env turbo build --filter=web
bun run format-and-lint
```

Manual smoke:

- Calendar without Google configured still works.
- Connect Google Calendar reaches Google OAuth and returns to the app.
- Create a manual event and confirm it appears in Google Calendar.
- Edit the event title/time and confirm the same Google event updates, not a
  duplicate.
- Delete the local event and confirm the Google event is removed or canceled
  according to the helper behavior.
- Add a Gmail account through the Gmail setup button using an app password.
- Add a custom SMTP test account if available.
- Send a simple email from Compose and confirm delivery.
- Existing IMAP sync still works for old accounts.

## Test plan

- `apps/web/lib/google-calendar-sync.test.ts`
  - payload mapping for timed/all-day events
  - manual-only filter
  - deterministic Google event IDs
  - insert conflict falls back to patch
  - delete not found treated as successful cleanup
- `apps/web/app/api/admin/calendar/google/*.test.ts`
  - OAuth state validation
  - callback requires admin/session state
  - status route redacts encrypted token
  - backfill only selects manual events
- `apps/web/app/api/admin/email-accounts/route.test.ts`
  - SMTP fields accepted and encrypted
  - response excludes IMAP/SMTP encrypted fields
  - invalid SMTP verification returns 400
- `apps/web/app/api/admin/email-accounts/[id]/send/route.test.ts`
  - send success
  - invalid recipient/body rejected
  - account without SMTP rejected
  - SMTP failure returns generic error

## Done criteria

ALL must hold:

- [ ] Google Calendar connection status, connect, disconnect, backfill, and
      retry routes exist and require admin auth/state where appropriate.
- [ ] Calendar create/update/delete records outbound Google sync success/failure
      without making local saves dependent on Google availability.
- [ ] No Google Calendar import/list/read path is implemented.
- [ ] Only manual events sync to Google in v1.
- [ ] Email accounts can store SMTP config without exposing encrypted secrets.
- [ ] Gmail/Outlook provider setup buttons prefill fields and expose provider
      setup links.
- [ ] Compose sends through `POST /api/admin/email-accounts/[id]/send`.
- [ ] Existing IMAP sync still works for legacy accounts.
- [ ] New tests cover Google sync mapping/routes and SMTP send validation.
- [ ] `cd apps/web && bun run typecheck` exits 0.
- [ ] `cd apps/web && bun test` exits 0 with required env loaded.
- [ ] `bunx turbo typecheck` exits 0.
- [ ] `bun --env-file=.env turbo build --filter=web` exits 0.
- [ ] `bun run format-and-lint` exits 0.
- [ ] `plans/README.md` status row for 013 updated to DONE.

## STOP conditions

Stop and report back if:

- The maintainer expects true OAuth mail login for Gmail/Outlook rather than
  assisted SMTP setup buttons.
- Google rejects `calendar.events.owned` for the required primary-calendar
  writes and broader `calendar.events` appears necessary.
- Any implementation starts reading/listing Google Calendar events.
- Existing generated holiday/birthday events must sync to Google by default.
- A provider requires OAuth2 for SMTP and password/app-password setup cannot
  work, especially Outlook.com. Report the provider-specific limitation instead
  of adding Graph/Gmail API sending.
- Existing account serialization exposes encrypted IMAP/SMTP secrets.
- `safe-email-password.ts` refactor would require rotating existing stored
  encrypted IMAP passwords.
- Calendar/inbox files have drifted due to ongoing plan 012 work.
- Tests require live Google/Microsoft/SMTP network calls. They must mock those
  dependencies.

## Follow-ups deliberately out of scope

- True Gmail OAuth/XOAUTH2 account linking for IMAP/SMTP.
- Microsoft OAuth/XOAUTH2 account linking for SMTP.
- Gmail API or Microsoft Graph Mail sending.
- Google Calendar two-way sync, conflict resolution, or calendar list import.
- Syncing generated holidays/birthdays to external calendars.
- Email attachments, drafts, signatures, Sent-folder IMAP append, or threading
  headers beyond basic `replyToMessageId`.
