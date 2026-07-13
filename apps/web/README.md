This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## LLM environment

All LLM traffic goes through the Vercel AI Gateway via the central service in
`lib/llm-service.ts`. Direct provider keys (`ANTHROPIC_API_KEY`,
`SEMANTIC_LLM_API_KEY`/`SEMANTIC_LLM_BASE_URL`) are no longer read; after the
48-hour rollback window following cutover, rotate/revoke them if unused
elsewhere.

- `AI_GATEWAY_API_KEY` — server-only Gateway key. Validated lazily when a
  generation/token-counting call starts; model discovery works without it.
  Never expose it to browser code.
- `SEMANTIC_LLM_MODEL` — optional, fully qualified Gateway id for the
  semantic/topic classification jobs (default `deepseek/deepseek-v3.2`).
- `LLM_UNATTENDED_MODEL` — optional, fully qualified Gateway id for unattended
  text jobs such as note categorization (default
  `anthropic/claude-haiku-4.5`).
- `LLM_LIVE_TESTS=1` — opt-in switch for the live Gateway contract tests in
  `lib/llm-live.test.ts` (requires a real, scoped `AI_GATEWAY_API_KEY`; never
  enable in untrusted PR CI).

Model selection UIs and jobs validate models against the live catalog
(`GET https://ai-gateway.vercel.sh/v1/models`); configure Gateway budgets and
model/provider allowlists in the Vercel dashboard.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
