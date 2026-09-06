import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { SandboxConfig } from "./config";
import { readConfig } from "./config";
import {
  createSessionSchema,
  runCommandSchema,
  SANDBOX_PROTOCOL_VERSION,
  writeFilesSchema,
} from "./contract";
import { DockerSandboxRuntime } from "./docker-runtime";

type SandboxRuntime = Pick<
  DockerSandboxRuntime,
  | "createSession"
  | "stopSession"
  | "runCommand"
  | "writeFiles"
  | "listFiles"
  | "readFile"
  | "portUrl"
  | "verifyPortToken"
  | "proxyPort"
  | "health"
>;

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(actual.slice(7));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

function errorResponse(error: unknown): Response {
  const message =
    error instanceof Error ? error.message : "Sandbox operation failed";
  const status = /No such container|is not running/i.test(message) ? 404 : 500;
  return Response.json(
    { error: message, protocolVersion: SANDBOX_PROTOCOL_VERSION },
    { status },
  );
}

export function createApp(
  config: SandboxConfig,
  runtime: SandboxRuntime = new DockerSandboxRuntime(config),
) {
  const app = new Hono();
  let healthyUntil = 0;

  app.get("/healthz", async (c) => {
    try {
      if (healthyUntil <= Date.now()) {
        await runtime.health();
        healthyUntil = Date.now() + 10_000;
      }
      return c.json({ ok: true, protocolVersion: SANDBOX_PROTOCOL_VERSION });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sandbox unavailable";
      return c.json(
        {
          ok: false,
          error: message,
          protocolVersion: SANDBOX_PROTOCOL_VERSION,
        },
        503,
      );
    }
  });

  app.use("/sessions/*", async (c, next) => {
    if (c.req.path.includes("/ports/") && c.req.path.includes("/proxy/")) {
      return next();
    }
    if (!tokenMatches(c.req.header("authorization"), config.apiToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });
  app.use("/sessions", async (c, next) => {
    if (!tokenMatches(c.req.header("authorization"), config.apiToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  app.post("/sessions", async (c) => {
    const parsed = createSessionSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    try {
      return c.json(await runtime.createSession(parsed.data));
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.delete("/sessions/:id", async (c) => {
    try {
      return c.json({ stopped: await runtime.stopSession(c.req.param("id")) });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.post("/sessions/:id/commands", async (c) => {
    const parsed = runCommandSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    try {
      return c.json(await runtime.runCommand(c.req.param("id"), parsed.data));
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.post("/sessions/:id/files", async (c) => {
    const parsed = writeFilesSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    try {
      return c.json({
        written: await runtime.writeFiles(c.req.param("id"), parsed.data),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.get("/sessions/:id/files", async (c) => {
    try {
      return c.json({
        entries: await runtime.listFiles(
          c.req.param("id"),
          c.req.query("path") || ".",
        ),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.get("/sessions/:id/files/*", async (c) => {
    try {
      const path = decodeURIComponent(c.req.path.split("/files/")[1] || "");
      const content = await runtime.readFile(c.req.param("id"), path);
      return new Response(Uint8Array.from(content).buffer, {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(content.byteLength),
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.get("/sessions/:id/ports/:port", (c) => {
    try {
      return c.json({
        url: runtime.portUrl(c.req.param("id"), Number(c.req.param("port"))),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.get("/sessions/:id/ports/:port/proxy/*", async (c) => {
    const id = c.req.param("id");
    const port = Number(c.req.param("port"));
    const marker = `/ports/${port}/proxy/`;
    const suffix = c.req.path.split(marker)[1] || "";
    const [expires = "", signature = "", ...pathParts] = suffix.split("/");
    if (!runtime.verifyPortToken(id, port, expires, signature)) {
      return c.json({ error: "Preview URL is invalid or expired" }, 401);
    }
    try {
      const url = new URL(c.req.url);
      const path = `${pathParts.join("/")}${url.search}`;
      return await runtime.proxyPort(id, port, path);
    } catch (error) {
      return errorResponse(error);
    }
  });

  return app;
}

let configuredApp: ReturnType<typeof createApp> | undefined;
const fetch = (request: Request) => {
  try {
    configuredApp ??= createApp(readConfig());
    return configuredApp.fetch(request);
  } catch (error) {
    return errorResponse(error);
  }
};

const port = Number(process.env.PORT ?? 3005);
export default { fetch, port };
