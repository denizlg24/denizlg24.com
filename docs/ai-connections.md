# Personal dashboard AI connections

Verified against provider documentation on 2026-11-17. These settings are for
the owner's personal dashboard. A public product offering subscription login
to other users would need a separate provider eligibility review.

## What is supported

| Connection | Authentication | What funds requests |
| --- | --- | --- |
| ChatGPT | Official Sign in with ChatGPT plan-usage OAuth preview | The selected ChatGPT account's plan allowance and its account-level usage settings |
| Claude | Official Claude Agent SDK, using a personal Claude Code setup token | The owner's Claude subscription allowance |
| Vercel Gateway | Encrypted Gateway key, or authorized Vercel OAuth app token | The selected Vercel team's Gateway credits |

OpenAI documents a direct Responses API plan-usage flow for eligible open-source
and locally hosted apps, including a protected-credential transfer procedure
for a self-hosted VM. Paid or hosted products have a separate partner route.
Repository visibility alone does not establish eligibility. See the
[overview](https://developers.openai.com/siwc/token-sharing-open-source) and
[self-hosted VM procedure](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).

Anthropic currently confirms personal SDK and `claude -p` subscription billing.
This implementation runs the official SDK and its unmodified runtime; it does
not send subscription tokens through the Messages API. Offering custom Claude
subscription login to other users has additional restrictions. See
[SDK subscription usage](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
and [authentication policy](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).

Vercel access-token authentication for model requests is documented. A Sign in
with Vercel app needs the **AI Gateway: Use** team permission, currently private
beta. Identity-only OAuth scopes are insufficient. See
[Gateway authentication](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway#vercel-access-token-authentication-for-model-requests)
and [permissions](https://vercel.com/docs/sign-in-with-vercel/scopes-and-permissions).

## Connect an account

Open **Settings → Models** on the web or desktop dashboard. The native iPhone
dashboard also exposes AI connection settings. Subscription selection affects
agent turns; embeddings, transcription, speech and background classification
retain their existing independently configured transports.

For ChatGPT, copy the host ID shown in settings, then run on the computer with
your browser:

```sh
cd apps/web
bun scripts/connect-chatgpt.ts --host-id urn:uuid:YOUR-DASHBOARD-HOST-ID
```

The helper uses an OpenAI browser authorization flow with PKCE, state and nonce,
validates the signed identity token, and writes an owner-only credential file
at `~/.config/deniz-dashboard/chatgpt-connection.json`. Import that protected
file in settings, load the account's available models, choose one, and save.
The dashboard then owns token renewal; do not run another client against a
copy of the same rotating refresh token. Never commit the credential file.
Use a different `--output` path to connect a different registration without
overwriting a local file.

For Claude, run Anthropic's `claude setup-token` with your own subscription and
save its result through the write-only Claude field. Select an explicit Claude
model supported by your account. API keys are rejected in this field. The SDK
runtime must be installed with its matching platform package; the web Docker
image includes the Linux runtime and points `CLAUDE_CODE_EXECUTABLE` at it.
See [setup-token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token).

The Claude bridge currently supports text conversations and app function
tools. Its runtime advertises tool schemas, then defers execution to the
dashboard's existing approval flow. Native shell/filesystem tools stay
disabled. Images and file input require further adapter work; they are not
silently treated as supported inputs. Use a persistent Node/Forge deployment
for this runtime, rather than an edge deployment.

For Gateway, paste a Gateway key and optional team ID/slug, then save. The
server verifies authentication without paid inference before replacing the
stored key. **Test** rechecks the selected credential. To enable Vercel OAuth,
register an app with the team permission above and set:

```text
VERCEL_APP_CLIENT_ID
VERCEL_APP_CLIENT_SECRET
VERCEL_APP_REDIRECT_URI
VERCEL_APP_GATEWAY_ENABLED=true
```

Register the exact callback URL
`https://YOUR-DASHBOARD/api/admin/ai-connections/vercel/callback`.
OAuth opens in an authenticated dashboard browser session, including when
started from desktop. No Vercel ID token is used as a Gateway credential.

## Credential and billing behavior

Secrets are encrypted with the existing AES-256-GCM server-secret helper and
`IMAP_ENCRYPTION_KEY`; this key remains outside the database. API responses
return connection metadata, never access tokens, refresh tokens or saved keys.
Mutation routes require admin authentication and reject cross-origin cookie
requests. OAuth callbacks use expiring, single-use, session-bound state.

Both OAuth providers rotate refresh tokens. Database claims serialize renewal,
and generation checks stop a stale refresh or callback from overwriting a new
connection or undoing a disconnect. ChatGPT disconnect attempts remote session
revocation and reports when it cannot confirm it. Remove the app in ChatGPT
settings if that happens.

An invalid selected subscription fails; it never switches to a paid provider.
Gateway must be selected explicitly. A saved Gateway connection takes
precedence over `AI_GATEWAY_API_KEY`; a bad saved key does not fall back.
Removing the saved Gateway connection restores the deployment environment key
if one is configured, as shown in settings. Changing the stored key reaches
all Gateway transports, rather than only the chat screen.

ChatGPT requests use the public Responses endpoint with stateless streaming
and namespaced app tools. Unsupported preview parameters are omitted. This
route does not provide the full Platform API feature set. See
[inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
and [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

Account-specific eligibility, live subscription sign-in, Vercel beta access and
actual quota consumption require the owner's real authorization. Automated
tests use synthetic provider streams and an isolated local database; they do
not consume subscription allowance or Gateway credits.

The agent model picker follows the active connection. For ChatGPT and Claude,
it displays the subscription model saved in Models settings; for Gateway, it
shows the Gateway catalog. Changing providers refreshes the desktop dock and
Study chat immediately, including an open conversation with an older model.
