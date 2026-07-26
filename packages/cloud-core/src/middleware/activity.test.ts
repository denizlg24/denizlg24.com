import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import type { ActivityEntryInput } from "../ops/activity";
import {
  activityCapture,
  categoryForPath,
  severityForStatus,
  shouldCapture,
} from "./activity";
import type { AuthVariables } from "./auth";

const SLOW_MS = 3_000;

function authenticatedUser(): AuthVariables["user"] {
  const now = new Date();
  return {
    id: "user-1",
    username: "deniz",
    email: "deniz@example.com",
    role: "superuser",
    status: "active",
    totpEnabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function decision(overrides: Partial<Parameters<typeof shouldCapture>[0]>) {
  return shouldCapture({
    method: "GET",
    path: "/api/storage/files",
    status: 200,
    durationMs: 5,
    slowRequestMs: SLOW_MS,
    ...overrides,
  });
}

describe("shouldCapture", () => {
  it("skips successful reads", () => {
    expect(decision({})).toBe(false);
    expect(decision({ method: "HEAD" })).toBe(false);
  });

  it("captures every mutation", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(decision({ method })).toBe(true);
    }
  });

  it("captures failures regardless of method", () => {
    expect(decision({ status: 404 })).toBe(true);
    expect(decision({ status: 500 })).toBe(true);
  });

  it("captures slow reads", () => {
    expect(decision({ durationMs: SLOW_MS })).toBe(true);
    expect(decision({ durationMs: SLOW_MS - 1 })).toBe(false);
  });

  it("only records 5xx for polled endpoints", () => {
    const polled = { path: "/api/ops/overview" };
    expect(decision({ ...polled })).toBe(false);
    expect(decision({ ...polled, status: 401 })).toBe(false);
    expect(decision({ ...polled, durationMs: 30_000 })).toBe(false);
    expect(decision({ ...polled, status: 503 })).toBe(true);
  });

  it("does not let the activity page log itself", () => {
    expect(decision({ path: "/api/ops/activity", method: "GET" })).toBe(false);
  });

  it("only records failures on S3, where every multipart part is a PUT", () => {
    expect(decision({ path: "/v2/bucket/key", method: "PUT" })).toBe(false);
    expect(decision({ path: "/v2/bucket/key", method: "DELETE" })).toBe(false);
    expect(
      decision({ path: "/v2/bucket/key", method: "GET", status: 403 }),
    ).toBe(true);
    expect(decision({ path: "/v2", method: "GET", status: 404 })).toBe(true);
  });

  it("records what a WebDAV client changes", () => {
    const dav = { path: "/dav/home/report.txt" };
    for (const method of ["PUT", "DELETE", "MKCOL", "MOVE", "COPY"]) {
      expect(decision({ ...dav, method, status: 201 })).toBe(true);
    }
  });

  it("ignores the read traffic a mount generates constantly", () => {
    const dav = { path: "/dav/home" };
    // Finder issues a PROPFIND per directory it draws, a LOCK before every
    // save, and a PROPPATCH after it. None of them change stored state.
    for (const method of [
      "PROPFIND",
      "GET",
      "HEAD",
      "LOCK",
      "UNLOCK",
      "PROPPATCH",
    ]) {
      expect(decision({ ...dav, method })).toBe(false);
    }
  });

  it("still records those reads when they fail", () => {
    expect(
      decision({ path: "/dav/home", method: "PROPFIND", status: 401 }),
    ).toBe(true);
    expect(decision({ path: "/dav/home", method: "LOCK", status: 423 })).toBe(
      true,
    );
  });
});

describe("categoryForPath", () => {
  it("prefers the most specific prefix", () => {
    expect(categoryForPath("/api/auth/admin/users")).toBe("admin");
    expect(categoryForPath("/api/auth/sign-in/username")).toBe("auth");
    expect(categoryForPath("/api/ops/terminal/sessions")).toBe("terminal");
    expect(categoryForPath("/api/ops/tasks/abc/runs")).toBe("tasks");
    expect(categoryForPath("/api/ops/containers")).toBe("ops");
  });

  it("gives the mounted drive its own category", () => {
    expect(categoryForPath("/dav")).toBe("dav");
    expect(categoryForPath("/dav/home/report.txt")).toBe("dav");
    // Not "storage": filtering the mount apart from the web client is the
    // point of a separate category.
    expect(categoryForPath("/api/storage/files")).toBe("storage");
  });

  it("falls back to system for unmatched paths", () => {
    expect(categoryForPath("/healthz")).toBe("system");
  });

  it("does not match a prefix that is only a string prefix", () => {
    expect(categoryForPath("/api/projectsomething")).toBe("system");
  });
});

describe("severityForStatus", () => {
  it("maps status classes to severities", () => {
    expect(severityForStatus(204)).toBe("info");
    expect(severityForStatus(404)).toBe("warn");
    expect(severityForStatus(500)).toBe("error");
  });
});

function createApp(
  recorded: ActivityEntryInput[],
  handler: (context: unknown) => Response | Promise<Response>,
) {
  const app = new Hono();
  let clock = 0;
  app.use(
    "/api/*",
    activityCapture({
      record: (entry) => recorded.push(entry),
      slowRequestMs: SLOW_MS,
      now: () => {
        clock += 25;
        return clock;
      },
    }),
  );
  app.all("/api/thing", handler as never);
  return app;
}

describe("activityCapture", () => {
  it("hands back the handler's own Response instance", async () => {
    // The same hazard cors.ts exists for: rebuilding the response would turn a
    // Bun.file() blob into a stream and lose sendfile().
    const original = new Response(new Blob(["payload"]), {
      headers: { "Content-Length": "7", "Content-Type": "application/pdf" },
    });
    const recorded: ActivityEntryInput[] = [];
    const app = createApp(recorded, () => original);

    const response = await app.request("/api/thing", { method: "POST" });

    expect(response).toBe(original);
    expect(response.headers.get("Content-Length")).toBe("7");
  });

  it("records the request with a duration", async () => {
    const recorded: ActivityEntryInput[] = [];
    const app = createApp(recorded, () => new Response(null, { status: 201 }));

    await app.request("/api/thing", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.7", "User-Agent": "probe/1" },
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: "http.request",
      method: "POST",
      path: "/api/thing",
      statusCode: 201,
      durationMs: 25,
      severity: "info",
      actorType: "anonymous",
      ip: "203.0.113.7",
      userAgent: "probe/1",
    });
  });

  it("records a thrown handler as a 500 and re-throws", async () => {
    const recorded: ActivityEntryInput[] = [];
    const app = createApp(recorded, () => {
      throw new Error("executor exploded");
    });
    app.onError((_error, context) => context.json({ error: true }, 500));

    const response = await app.request("/api/thing", { method: "GET" });

    expect(response.status).toBe(500);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      statusCode: 500,
      severity: "error",
      message: "executor exploded",
      metadata: { errorName: "Error" },
    });
  });

  it("attributes the request to the authenticated user", async () => {
    const recorded: ActivityEntryInput[] = [];
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("/api/*", async (context, next) => {
      context.set("user", authenticatedUser());
      return next();
    });
    app.use(
      "/api/*",
      activityCapture({ record: (entry) => recorded.push(entry) }),
    );
    app.delete("/api/thing", (context) => context.json({ ok: true }));

    await app.request("/api/thing", { method: "DELETE" });

    expect(recorded[0]).toMatchObject({
      actorType: "user",
      actorId: "user-1",
      actorLabel: "deniz",
    });
  });

  it("attributes signed S3 traffic to a credential", async () => {
    const recorded: ActivityEntryInput[] = [];
    const app = new Hono();
    app.use("/v2/*", activityCapture({ record: (e) => recorded.push(e) }));
    app.get("/v2/bucket/key", (context) => context.json({ error: true }, 403));

    await app.request("/v2/bucket/key", {
      headers: {
        Authorization:
          "AWS4-HMAC-SHA256 Credential=key/20260726/eu-west-1/s3/aws4_request, SignedHeaders=host, Signature=" +
          "0".repeat(64),
      },
    });

    expect(recorded[0]).toMatchObject({
      category: "s3",
      actorType: "s3_credential",
      statusCode: 403,
    });
  });
});
