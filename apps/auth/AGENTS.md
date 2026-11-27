<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Passkey offer

- **The auth app infers "this device has a passkey"; nothing can ask.**
  `apps/auth/lib/passkey-device.ts` marks the browser (localStorage on the
  auth origin) when a passkey is registered or used there; the login page
  then runs the modal ceremony on arrival and clears the mark when it is
  dismissed. WebAuthn immediate mediation was considered and dropped: it
  needs a user gesture, so it cannot fire on a redirect landing. After a
  password sign-in with a plain `returnTo` (never an authorization — the
  provider resumes those itself), `decidePasskeyOffer` in
  `lib/passkey-offer.ts` offers to add one unless the mark is set, the
  account has `passkeyOfferDismissed` (`auth_user`, 0051, set through
  `updateUser`), the browser snoozed it, or a synced passkey's provider
  (by `aaguid`) already reaches this platform. Accepting when the device
  holds one fails with `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED`, which
  sets the mark instead of showing an error.
