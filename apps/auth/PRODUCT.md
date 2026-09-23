# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- The owner (Deniz), the only superuser: signs in from a laptop or phone,
  usually because Forge, cloud, storage, status or denizlg24.com bounced him
  here, or because an MCP client (Claude) asked for consent. Manages OAuth
  clients, passkeys, trusted devices and sessions here.
- Family members with regular cloud accounts on Macs, Windows laptops and
  iPhones: sign in only to reach storage.denizlg24.com. They meet the
  sign-in, second-factor, enrollment and backup-code screens and nothing
  else; consent and management refuse non-superusers.
- Later, explicitly out of scope today: other people's users, once the
  service is offered through an SDK. The flow screens are designed so that
  audience needs no redesign, only configuration.

## Product Purpose

One identity for everything under denizlg24.com. auth.denizlg24.com is the
login, consent and account-security UI for the cloud API's Better Auth user
and its OAuth 2.1 authorization server. Success is a sign-in that a family
member completes on a phone without help, a consent screen the owner can
judge in a glance, and management pages that make a security question
answerable in seconds.

## Positioning

The authorization server is the same API that runs the cloud, so identity,
sessions, OAuth grants, passkeys and device trust are one record, not a
federation. Every token is a superuser token; the flow's job is to be strict
about who gets one and gentle with everyone else.

## Operating Context

- Every app sends a signed-out browser here with `returnTo`; the OAuth
  provider sends one with a signed authorization query. A visitor is always
  on the way somewhere, and the page knows where.
- TOTP is mandatory for every account; enrollment happens on first sign-in
  and shows backup codes exactly once. A passkey is an alternative that
  answers both factors. A browser that has used one is prompted for it on
  arrival; a password sign-in headed to an app (not an authorization) is
  followed by a one-screen offer to add one when nothing suggests the
  device already has it — "Not now" snoozes a month, "Don't ask again" is
  account-wide.
- Consent only happens for dynamically registered clients (MCP); first-party
  clients skip it. The consent page is what Claude's users see.
- Management: OAuth clients (create web/native/service, rotate, disable),
  passkeys (add/rename/remove), trusted devices (count, forget), sessions.

## Capabilities and Constraints

- UI only: the app talks to `api.denizlg24.com` from the browser through
  `@repo/cloud-auth-client` (Better Auth client) and `@repo/cloud-ui/api-client`
  (`/api/*` JSON with a `data` envelope). It holds no secrets and does no
  server-side auth.
- Framed rendering is refused (`frame-ancestors 'none'`): the consent page
  grants superuser tokens with one click.
- Product copy is allowed throughout this app (decided 2026-09-17): the
  single-user "no explanatory copy" rule of the monorepo does not apply here.
- Terminology: "passkey", "authenticator app", "backup code" (the API calls
  the latter a recovery/backup code), "trusted device", "client" (OAuth
  client), "resource" (an OAuth resource server).
- Undecided: the multi-user SDK, tenant branding, and any self-service
  account creation beyond the signup-token redemption that exists today.

## Brand Commitments

- Name: **deniz auth**. Wordmark "deniz" with "auth" set lighter, matching
  the sibling apps ("deniz" + "cloud"/"forge").
- Mark: the pixel-art padlock (`apps/auth/app/icon.png`, dark green on
  light green with a cream ground). The 1254 px `public/auth_logo.png` is the
  same mark at source size.
- Visual system: the monorepo design tokens in `packages/ui/src/theme.css`
  (sage `#a1bc98`, deep green `#303630`, cream `#f9f8f6`, surface `#f1f3e0`,
  muted `#d2dcb6`; dark theme mirrored), Geist Sans and Geist Mono, shadcn
  primitives from `@repo/ui`, radius 0.625rem. Light and dark follow the
  system with a manual override shared across the cloud apps.

## Evidence on Hand

- Real clients, resources and grant counts come from the API; nothing is
  mocked. There are no testimonials, logos of customers or usage numbers,
  and none may be invented.

## Product Principles

- The visitor is on the way somewhere: say where, and get them there with
  the fewest decisions.
- Strict about tokens, gentle with people: a refusal names the reason and
  the recovery.
- One security fact per glance: passkeys, trusted devices, sessions and
  clients each answer "what can reach my account right now".
- Familiar first: the tool disappears into the task; brand lives in the
  mark, the palette and precise details, never in novel controls.

## Accessibility & Inclusion

- Keyboard-complete flows; visible focus; labels on every control.
- Respects `prefers-reduced-motion` and `prefers-color-scheme`.
- Phone-first for the flow screens: family members mostly arrive on iPhones.
