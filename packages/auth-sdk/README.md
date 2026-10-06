# @denizlg24/auth

Sign in with deniz auth. One account per person, usable across every app that
integrates it; each app gets its own consent, its own grants and its own
access tokens.

```
bun add @denizlg24/auth
```

| Import | For |
|---|---|
| `@denizlg24/auth/next` | A Next.js app with a server: sign-in routes, an HttpOnly session cookie, refresh in the proxy |
| `@denizlg24/auth/server` | An API that accepts deniz auth access tokens; service-to-service tokens |
| `@denizlg24/auth/client` | A browser SPA, a desktop shell or a mobile app (public client, PKCE) |
| `@denizlg24/auth/react` | `useSession()` and `<SignedIn>` over either of the above |
| `@denizlg24/auth` | The token client and PKCE helpers the others are built on |

## Before you start

Create your app's OAuth client on auth.denizlg24.com. You get a client id and,
for a server-side client, a secret shown once. Register the exact redirect
URIs you will use. The *resource* is your API's identifier — the `aud` its
access tokens carry — and is usually your app's origin.

## Next.js

```ts
// lib/auth.ts
import { createDenizAuth } from "@denizlg24/auth/next";

export const auth = createDenizAuth(() => ({
  clientId: process.env.DENIZ_AUTH_CLIENT_ID!,
  clientSecret: process.env.DENIZ_AUTH_CLIENT_SECRET!,
  secret: process.env.DENIZ_AUTH_SECRET!, // ≥ 32 random characters
  baseUrl: "https://app.example.com",
  resource: "https://app.example.com",
}));
```

Configuration is read on first use, so `next build` does not need the secrets.

```ts
// app/auth/[...deniz]/route.ts — login, callback, logout, session
import { auth } from "@/lib/auth";
export const { GET, POST } = auth;
```

```ts
// proxy.ts (middleware.ts before Next 16) — keeps the access token fresh
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export function proxy(request: NextRequest) {
  return auth.proxy(request);
}

export const config = { matcher: ["/dashboard/:path*", "/api/:path*"] };
```

```tsx
// app/dashboard/page.tsx
import { auth } from "@/lib/auth";

export default async function Dashboard() {
  const session = await auth.requireSession("/dashboard");
  const res = await fetch("https://api.example.com/me", {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  // …
}
```

Register `https://app.example.com/auth/callback` as the redirect URI. Link to
`auth.loginUrl("/dashboard")` to sign in and `auth.logoutUrl()` to sign out.

`getSession()` never refreshes: a server component cannot set cookies, and
refreshing there would rotate the refresh token away and lose the new one.
Every path that reads the session must be covered by the proxy matcher.

Options worth knowing: `basePath` (default `/auth`), `afterSignInPath`,
`afterSignOutPath`, `errorPath` (failures land on `?auth_error=<reason>`),
`scope`, `cookieName`, and `authorize(token)` to refuse a sign-in the token
alone does not justify.

## API / resource server

```ts
import { createVerifier, hasScope } from "@denizlg24/auth/server";

const verifier = createVerifier({ audience: "https://api.example.com" });

app.use(async (c, next) => {
  let token;
  try {
    token = await verifier.verifyRequest(c.req.raw);
  } catch {
    return c.json({ error: "auth unavailable" }, 503);
  }
  if (!token) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", token.userId);
  await next();
});
```

`verify` resolves to `null` for a token that is not acceptable (expired, wrong
audience, bad signature) and **throws** when the signing keys cannot be
fetched. Answer that with 5xx, not 401: clients treat 401 as "sign in again".

A verified token carries `userId` (`sub`), `clientId`, `tenant` (your app's
id), `scopes`, `machine` (true for service tokens) and the raw `claims`.

`userId` is the person's deniz account id and is **the same in every app**
that integrates deniz auth. Do not treat it as a secret, and do not assume an
id you have never seen belongs to nobody.

### Service-to-service

```ts
import { createMachineTokenSource } from "@denizlg24/auth/server";

const tokens = createMachineTokenSource({
  clientId: process.env.WORKER_CLIENT_ID!,
  clientSecret: process.env.WORKER_CLIENT_SECRET!,
  resource: "https://api.example.com",
});

await fetch(url, { headers: { authorization: `Bearer ${await tokens.getToken()}` } });
```

Tokens are cached until a minute before expiry; call `tokens.invalidate()`
after a 401.

## SPA, desktop and mobile

```ts
import { browserStorage, createPublicClient } from "@denizlg24/auth/client";

export const auth = createPublicClient({
  clientId: "…",
  resource: "https://api.example.com",
  redirectUri: `${location.origin}/callback`,
  storage: browserStorage(),
});

// On the callback page
if (auth.isCallback(location.href)) {
  await auth.handleCallback(location.href);
  history.replaceState(null, "", "/");
}

// Anywhere
await auth.signIn();
const res = await auth.fetch("https://api.example.com/me");
```

`getAccessToken()` refreshes shortly before expiry, once for any number of
concurrent callers. A refused refresh signs out (`status: "signed-out"`,
`error: "session_expired"`); an unreachable issuer throws
`AuthUnavailableError` and keeps the session.

Native apps inject their own pieces. A desktop shell binding a random
loopback port passes the URI per sign-in, and opens the URL in the system
browser itself:

```ts
const auth = createPublicClient({ clientId, resource, storage: secureStore });
const { redirectUri, callback } = await listenOnLoopback();
await openInBrowser(await auth.createSignIn({ redirectUri }));
await auth.handleCallback(await callback);
```

On iOS/Android, use a private-scheme redirect (`com.example.app:/callback`)
with an auth session API and the platform keychain as `storage`.

`browserStorage()` keeps tokens in `localStorage`, which any script on the
page can read. If your app has a server, the Next entry's HttpOnly cookie is
the safer place.

## React

```tsx
"use client";
import { DenizAuthProvider, SignedIn, SignedOut, useSession } from "@denizlg24/auth/react";

// Next: pass the user you already have on the server to skip the first fetch
<DenizAuthProvider initialUser={session?.user ?? null}>{children}</DenizAuthProvider>

// SPA / native
<DenizAuthProvider client={auth}>{children}</DenizAuthProvider>

function Account() {
  const { user, signIn, signOut } = useSession();
  return (
    <>
      <SignedOut><button onClick={() => signIn()}>Sign in</button></SignedOut>
      <SignedIn><button onClick={() => signOut()}>Sign out {user?.id}</button></SignedIn>
    </>
  );
}
```

## Errors

| Class | Meaning |
|---|---|
| `OAuthGrantError` | The token endpoint refused. `grantInvalid` is true for `invalid_grant` / `invalid_client` — the session is over. |
| `AuthUnavailableError` | The issuer could not be reached or answered garbage. Retry; do not sign anyone out. |
| `AuthorizationResponseError` | A callback that does not belong to a sign-in this client started (`state_mismatch`, `issuer_mismatch`), or the user declined (`access_denied`). |

## Development

`issuer` defaults to `https://api.denizlg24.com/api/auth`; point it at a local
API with `issuer: "http://localhost:3001/api/auth"`.
