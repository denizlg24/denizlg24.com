# Envoy App

The Next.js/Hono API and public site for the Envoy encrypted environment-file
CLI.

## Development

```bash
bun install
bunx prisma migrate dev
bun run dev
```

Validation:

```bash
bun run test
bun run lint
bun run build
```

## Blob access API

All routes require an Envoy bearer token.

```text
POST /api/projects/:projectId/blobs/:hash/upload
GET  /api/projects/:projectId/blobs/:hash/download
PUT  /api/projects/:projectId/blobs/:hash/access
```

The access body is `{ "memberIds": ["<project-user-id>"] }`. An empty array is
owner-only; `null` removes a restriction. Existing blobs without a policy remain
available to all project members for backwards compatibility. Only owners can
create, replace, or remove restrictions; ordinary members may confirm
unrestricted access for a new blob.

Access policy rows protect file blobs only. Encrypted manifests and commits stay
available to project members so clients can traverse history, while restricted
file downloads return HTTP 403.
