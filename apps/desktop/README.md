# desktop

The native client for the personal dashboard: a Next.js application wrapped by
Tauri. It holds no data of its own — everything comes from the API in
`apps/web` over HTTP with a bearer token, so the desktop app is a second front
end to the same surfaces the `/admin` dashboard serves.

The design is deliberately minimalist and editorial: small type, muted
secondary text, tabular numerals for anything numeric, and sheets rather than
page navigations wherever a detail view would otherwise cost a route change.

## Structure

- `app/dashboard/{feature}/page.tsx` — client pages, one per feature, with
  their sub-components in a local `_components/` directory
- `components/ui/` — the shadcn/Radix primitives
- `components/navigation/` — the sidebar groups
- `lib/api-wrapper.ts` — the API client; the base URL comes from the
  environment rather than a hardcoded host
- `lib/data-types.ts` — a re-export shim over `@repo/schemas`, plus the
  UI-state types that only exist on the desktop side

API calls return a union of the success type and an error type, so callers
discriminate on the error shape rather than catching. Mutations are optimistic
and roll back on failure.

## Development

```sh
bunx turbo dev --filter=desktop
```

Types are shared: the canonical wire contracts are Zod schemas in
`packages/schemas`, and every TypeScript type is inferred from them. A contract
change starts there, and `bunx turbo typecheck` surfaces the consequences in
both this app and the web app at once.
