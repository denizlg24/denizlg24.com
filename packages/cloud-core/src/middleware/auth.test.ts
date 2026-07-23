import { describe, expect, it } from "bun:test";
import type { ApiKeyScope } from "@repo/schemas/cloud";
import { Hono } from "hono";

import type { SafeUserRecord } from "../services/types";
import { type AuthVariables, requireRole, requireScope } from "./auth";

const user: SafeUserRecord = {
  id: "6a2150ee-03ea-4b5a-a67b-102788069cb4",
  username: "user",
  email: null,
  role: "user",
  status: "active",
  totpEnabled: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createApp(options: {
  role: "user" | "superuser";
  scopes: ApiKeyScope[] | undefined;
  requiredRole?: "user" | "superuser";
  requiredScopes?: ApiKeyScope[];
}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use(async (context, next) => {
    context.set("user", { ...user, role: options.role });
    context.set(
      "sessionId",
      options.scopes === undefined ? "session-id" : undefined,
    );
    context.set("project", undefined);
    context.set("scopes", options.scopes);
    return next();
  });

  if (options.requiredRole) {
    app.use(requireRole(options.requiredRole));
  }
  if (options.requiredScopes) {
    app.use(requireScope(...options.requiredScopes));
  }

  app.get("/test", (context) => context.json({ ok: true }));
  return app;
}

describe("authorization middleware", () => {
  it("enforces roles", async () => {
    const denied = await createApp({
      role: "user",
      scopes: undefined,
      requiredRole: "superuser",
    }).request("/test");
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Insufficient permissions",
      },
    });

    const allowed = await createApp({
      role: "superuser",
      scopes: undefined,
      requiredRole: "superuser",
    }).request("/test");
    expect(allowed.status).toBe(200);
  });

  it("lets human sessions bypass API key scope checks", async () => {
    const response = await createApp({
      role: "user",
      scopes: undefined,
      requiredScopes: ["storage:read", "storage:write"],
    }).request("/test");

    expect(response.status).toBe(200);
  });

  it("requires every requested API key scope", async () => {
    const denied = await createApp({
      role: "user",
      scopes: ["storage:read"],
      requiredScopes: ["storage:read", "storage:write"],
    }).request("/test");
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: {
        code: "INSUFFICIENT_SCOPE",
        message: "Required scopes: storage:read, storage:write",
      },
    });

    const allowed = await createApp({
      role: "user",
      scopes: ["storage:read", "storage:write"],
      requiredScopes: ["storage:read", "storage:write"],
    }).request("/test");
    expect(allowed.status).toBe(200);
  });
});
