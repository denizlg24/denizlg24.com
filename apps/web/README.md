# web

The public site at denizlg24.com and the private `/admin` dashboard behind it,
plus the API that the desktop app and the browser extension consume. Next.js
with MongoDB, Tailwind and shadcn/ui, deployed by Forge from its own container
image.

The canonical wire contracts for every one of those API surfaces are Zod
schemas in `packages/schemas`; the types here are inferred from them rather
than declared locally.

## LLM environment

All LLM traffic goes through the Vercel AI Gateway via the central service in
`lib/llm-service.ts`. Application code never imports a provider SDK or builds a
provider URL; operations are added to that service instead, which is what keeps
usage accounting and model resolution in one place. The direct provider keys it
replaced no longer exist in any environment or in the turbo passthrough list.

Two deliberate exceptions exist for capabilities the Gateway cannot carry —
multimodal embedding and speech-to-text. Each lives in a single transport
module under `lib/llm-transports/`, application code still only calls the
service, and because neither model appears in the Gateway catalog its pricing
is a maintained constant rather than a live lookup.

- `AI_GATEWAY_API_KEY` — server-only Gateway key. Validated lazily when a
  generation/token-counting call starts; model discovery works without it.
  Never expose it to browser code.

Model choices are settings, not environment variables. Pick them under
`/admin/dashboard/settings`; each stores a fully qualified Gateway id, and
clearing one falls back to the built-in default in `lib/llm-model-settings.ts`.

- Semantic model — JSON and classification work: note keywords, merchant
  classification, and the fallback for agent-memory formation (default
  `deepseek/deepseek-v3.2`).
- Unattended model — background text jobs such as note categorization,
  voice-note drafts and titles, and agent training (default
  `anthropic/claude-haiku-4.5`).

- `LLM_LIVE_TESTS=1` — opt-in switch for the live Gateway contract tests in
  `lib/llm-live.test.ts` (requires a real, scoped `AI_GATEWAY_API_KEY`; never
  enable in untrusted PR CI).

Model selection UIs and jobs validate models against the live catalog
(`GET https://ai-gateway.vercel.sh/v1/models`); configure Gateway budgets and
model/provider allowlists in the Vercel dashboard.

## Development

```sh
bunx turbo dev --filter=web
```

Tests import modules that expect a Mongo connection string in the environment,
so `MONGODB_URI` must be set — a dummy value is enough — and a production build
additionally needs the transactional email key present at page-data collection
time.
