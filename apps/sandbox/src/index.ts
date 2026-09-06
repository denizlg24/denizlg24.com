import { Hono } from "hono";

import { SANDBOX_PROTOCOL_VERSION } from "./contract";

/**
 * The code sandbox, unimplemented.
 *
 * The agent's eight sandbox tools ran on Vercel Sandbox, which authenticated
 * through a `VERCEL_OIDC_TOKEN` the Vercel runtime injected. Nothing injects it
 * on Forge, so every call has returned a configuration error since the move.
 * This app is where the capability comes back — on Forge rather than the Pi,
 * because it wants memory and CPU that the box serving the databases should not
 * be lending to model-authored code.
 *
 * Only the shell exists so far: routes, the wire contract and the deployment
 * are settled, execution is not. `/healthz` answers so a deploy can go ready;
 * every real route answers 501 and names what is missing, which is what keeps
 * this honest — a stub that pretended to run code would be worse than the error
 * it replaces.
 *
 * Before implementing, read `docs/internal/plans/019-ui-ux-fixes-sep5.md` (B10)
 * and settle the isolation question first. `FORWARDED_ENV_KEYS` in
 * `apps/web/lib/sandbox.ts` pushes MONGODB_URI, DATABASE_URL, REDIS_URL, the S3
 * access key and secret and CLOUD_API_TOKEN into every sandbox. Handing that set
 * to arbitrary model-authored code is a decision to make deliberately, not one
 * to inherit — a read-only replica URI and a scoped S3 credential would narrow
 * it a long way.
 */
const app = new Hono();

const notImplemented = (what: string) =>
  Response.json(
    {
      error: `The sandbox is not implemented yet: ${what}. See docs/internal/plans/019-ui-ux-fixes-sep5.md (B10).`,
      protocolVersion: SANDBOX_PROTOCOL_VERSION,
    },
    { status: 501 },
  );

app.get("/healthz", (c) =>
  c.json({ ok: true, protocolVersion: SANDBOX_PROTOCOL_VERSION }),
);

app.post("/sessions", () => notImplemented("creating a session"));
app.delete("/sessions/:id", () => notImplemented("stopping a session"));
app.post("/sessions/:id/commands", () => notImplemented("running a command"));
app.post("/sessions/:id/files", () => notImplemented("writing files"));
app.get("/sessions/:id/files", () => notImplemented("listing files"));
app.get("/sessions/:id/files/*", () => notImplemented("reading a file"));
app.get("/sessions/:id/ports/:port", () => notImplemented("exposing a port"));

const port = Number(process.env.PORT ?? 3005);

export default { fetch: app.fetch, port };
